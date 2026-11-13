'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';
import { invalid, str, strs, UUID_RE, type ActionState } from '@/lib/actions';
import { firmDateStamp } from '@/lib/naming/filename';
import { subfolderNeedsBusiness } from '@/lib/naming/folders';
import { notifyDocumentsRequested, notifyInvite, notifyRedo } from '@/lib/requests/notify';
import { requestMeta } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';

const assignSchema = z.object({
  client_id: z.string().regex(UUID_RE),
  document_type_ids: z.array(z.string().regex(UUID_RE)),
  bundle_id: z.union([z.literal(''), z.string().regex(UUID_RE)]),
  tax_year: z.union([
    z.literal(''),
    z.coerce.number().int().min(1990, 'Enter a valid year.').max(2100, 'Enter a valid year.'),
  ]),
  business_name: z.string().trim().max(120),
  note_to_client: z.string().trim().max(1000),
  due_date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.')]),
  notify: z.boolean(),
});

export async function assignRequestsAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = assignSchema.safeParse({
    client_id: str(form, 'client_id'),
    document_type_ids: [...new Set(strs(form, 'document_type_ids'))],
    bundle_id: str(form, 'bundle_id'),
    tax_year: str(form, 'tax_year'),
    business_name: str(form, 'business_name'),
    note_to_client: str(form, 'note_to_client'),
    due_date: str(form, 'due_date'),
    notify: form.get('notify') === 'on',
  });
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  if (input.due_date && input.due_date < firmDateStamp(new Date())) {
    return { ok: false, fieldErrors: { due_date: 'The due date is in the past.' } };
  }

  const db = serviceSupabase();
  const { data: client } = await db
    .from('clients')
    .select('id, status')
    .eq('id', input.client_id)
    .maybeSingle();
  if (!client) return { ok: false, message: 'Unknown client.' };
  if (client.status === 'archived')
    return { ok: false, message: 'Restore this client before requesting documents.' };

  const typeIds = new Set(input.document_type_ids);
  if (input.bundle_id) {
    const { data: items } = await db
      .from('request_bundle_items')
      .select('document_type_id')
      .eq('bundle_id', input.bundle_id);
    for (const item of items ?? []) typeIds.add(item.document_type_id);
  }
  if (typeIds.size === 0)
    return { ok: false, message: 'Choose a bundle or at least one document type.' };

  const { data: types } = await db
    .from('document_types')
    .select('id, name, requires_year, target_subfolder, active')
    .in('id', [...typeIds])
    .eq('active', true);
  if (!types?.length) return { ok: false, message: 'Those document types are not available.' };

  const taxYear = input.tax_year === '' ? null : input.tax_year;
  const business = input.business_name || null;
  const needsYear = types.filter((t) => t.requires_year).map((t) => t.name);
  if (needsYear.length && !taxYear) {
    return {
      ok: false,
      fieldErrors: { tax_year: `A tax year is required for: ${needsYear.join(', ')}.` },
    };
  }
  const needsBusiness = types
    .filter((t) => subfolderNeedsBusiness(t.target_subfolder))
    .map((t) => t.name);
  if (needsBusiness.length && !business) {
    return {
      ok: false,
      fieldErrors: {
        business_name: `A business name is required for: ${needsBusiness.join(', ')}.`,
      },
    };
  }

  // Skip types that already have an open request for the same year and business.
  const { data: open } = await db
    .from('document_requests')
    .select('document_type_id, tax_year, business_name')
    .eq('client_id', client.id)
    .in('status', ['requested', 'redo', 'uploaded']);
  const isOpen = (t: { id: string; requires_year: boolean; target_subfolder: string }) =>
    (open ?? []).some(
      (o) =>
        o.document_type_id === t.id &&
        (t.requires_year ? o.tax_year === taxYear : true) &&
        (subfolderNeedsBusiness(t.target_subfolder)
          ? (o.business_name ?? '') === (business ?? '')
          : true),
    );
  const toCreate = types.filter((t) => !isOpen(t));
  const skipped = types.length - toCreate.length;
  if (toCreate.length === 0)
    return { ok: false, message: 'Those documents are already requested.' };

  const now = new Date().toISOString();
  const { data: created, error } = await db
    .from('document_requests')
    .insert(
      toCreate.map((t) => ({
        client_id: client.id,
        document_type_id: t.id,
        tax_year: t.requires_year ? taxYear : null,
        business_name: subfolderNeedsBusiness(t.target_subfolder) ? business : null,
        note_to_client: input.note_to_client || null,
        due_date: input.due_date || null,
        requested_by: admin.aid,
        requested_at: now,
        status_changed_at: now,
      })),
    )
    .select('id');
  if (error || !created)
    return { ok: false, message: 'Could not create the requests. Please try again.' };

  const meta = await requestMeta();
  await Promise.all(
    created.map((r) =>
      audit({
        actorType: 'admin',
        actorId: admin.aid,
        action: 'request.created',
        targetType: 'request',
        targetId: r.id,
        metadata: { client_id: client.id },
        meta,
      }),
    ),
  );

  let emailNote = '';
  if (input.notify) {
    const sent = await notifyDocumentsRequested(
      { actorType: 'admin', actorId: admin.aid },
      client.id,
      created.map((r) => r.id),
      { note: input.note_to_client || null, dueDate: input.due_date || null },
    );
    emailNote = sent
      ? ' The client was emailed.'
      : ' The email could not be sent; use "Resend invite".';
  }

  revalidatePath(`/admin/clients/${client.id}`);
  const skippedNote = skipped ? ` ${skipped} already requested and skipped.` : '';
  return {
    ok: true,
    message: `Requested ${created.length} document${created.length === 1 ? '' : 's'}.${skippedNote}${emailNote}`,
  };
}

export async function sendInviteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const clientId = str(form, 'client_id');
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  const ok = await notifyInvite({ actorType: 'admin', actorId: admin.aid }, clientId);
  if (ok) {
    await audit({
      actorType: 'admin',
      actorId: admin.aid,
      action: 'client.invited',
      targetType: 'client',
      targetId: clientId,
      meta: await requestMeta(),
    });
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return ok
    ? { ok: true, message: 'Invite sent.' }
    : { ok: false, message: 'The invite could not be sent.' };
}

async function loadRequest(requestId: string) {
  return serviceSupabase()
    .from('document_requests')
    .select('id, client_id, status')
    .eq('id', requestId)
    .maybeSingle();
}

export async function cancelRequestAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const requestId = str(form, 'request_id');
  if (!UUID_RE.test(requestId)) return { ok: false, message: 'Unknown request.' };
  const { data: request } = await loadRequest(requestId);
  if (!request) return { ok: false, message: 'Unknown request.' };
  const db = serviceSupabase();
  const { count } = await db
    .from('uploads')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId)
    .eq('status', 'complete');
  if ((count ?? 0) > 0)
    return { ok: false, message: 'This request has uploads, so it cannot be removed.' };
  const { error } = await db.from('document_requests').delete().eq('id', requestId);
  if (error) return { ok: false, message: 'Could not remove the request.' };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'request.cancelled',
    targetType: 'request',
    targetId: requestId,
    metadata: { client_id: request.client_id },
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${request.client_id}`);
  return { ok: true, message: 'Request removed.' };
}

export async function acceptRequestAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const requestId = str(form, 'request_id');
  if (!UUID_RE.test(requestId)) return { ok: false, message: 'Unknown request.' };
  const { data: request } = await loadRequest(requestId);
  if (!request) return { ok: false, message: 'Unknown request.' };
  if (request.status !== 'uploaded')
    return { ok: false, message: 'Only uploaded documents can be accepted.' };

  const now = new Date().toISOString();
  const { error } = await serviceSupabase()
    .from('document_requests')
    .update({
      status: 'accepted',
      reviewed_by: admin.aid,
      reviewed_at: now,
      status_changed_at: now,
      redo_note: null,
    })
    .eq('id', requestId)
    .eq('status', 'uploaded');
  if (error) return { ok: false, message: 'Could not update the request.' };
  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'request.accepted',
    targetType: 'request',
    targetId: requestId,
    metadata: { client_id: request.client_id },
    meta: await requestMeta(),
  });
  revalidatePath(`/admin/clients/${request.client_id}`);
  return { ok: true, message: 'Accepted.' };
}

const redoSchema = z.object({
  request_id: z.string().regex(UUID_RE),
  redo_note: z
    .string()
    .trim()
    .min(3, 'Tell the client what to fix.')
    .max(1000, 'Keep the note under 1000 characters.'),
  notify: z.boolean(),
});

export async function redoRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = redoSchema.safeParse({
    request_id: str(form, 'request_id'),
    redo_note: str(form, 'redo_note'),
    notify: form.get('notify') === 'on',
  });
  if (!parsed.success) return invalid(parsed.error);
  const { data: request } = await loadRequest(parsed.data.request_id);
  if (!request) return { ok: false, message: 'Unknown request.' };
  if (request.status !== 'uploaded' && request.status !== 'accepted') {
    return { ok: false, message: 'Only received documents can be sent back for a redo.' };
  }

  const now = new Date().toISOString();
  const { error } = await serviceSupabase()
    .from('document_requests')
    .update({
      status: 'redo',
      redo_note: parsed.data.redo_note,
      reviewed_by: admin.aid,
      reviewed_at: now,
      status_changed_at: now,
    })
    .eq('id', request.id);
  if (error) return { ok: false, message: 'Could not update the request.' };

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'request.redo',
    targetType: 'request',
    targetId: request.id,
    metadata: { client_id: request.client_id },
    meta: await requestMeta(),
  });

  let emailNote = '';
  if (parsed.data.notify) {
    const sent = await notifyRedo({ actorType: 'admin', actorId: admin.aid }, request.id);
    emailNote = sent ? ' The client was emailed.' : ' The email could not be sent.';
  }
  revalidatePath(`/admin/clients/${request.client_id}`);
  return { ok: true, message: `Marked as needing a redo.${emailNote}` };
}
