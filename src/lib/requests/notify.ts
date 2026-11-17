import 'server-only';
import { appEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { adminNotifyRecipients, sendEmail } from '@/lib/email/send';
import {
  documentsRequestedEmail,
  inviteEmail,
  newUploadEmail,
  redoNeededEmail,
} from '@/lib/email/templates';
import { serviceSupabase } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/status';
import type { ActorType } from '@/lib/db/types';
import { documentLabel } from '@/lib/requests/document-label';

/**
 * Notification emails. Each send is recorded in the audit log (email.sent / email.failed)
 * against the client or request it concerns, by ID only.
 */

interface Actor {
  actorType: ActorType;
  actorId: string | null;
}

function portalUrl(): string {
  return `${appEnv().APP_BASE_URL}/login`;
}

async function record(
  actor: Actor,
  ok: boolean,
  kind: string,
  targetType: 'client' | 'request' | 'upload',
  targetId: string,
) {
  await audit({
    ...actor,
    action: ok ? 'email.sent' : 'email.failed',
    targetType,
    targetId,
    metadata: { kind },
  });
}

/** Everyone approved to sign in for a client, each with their own first name. */
async function approvedRecipients(
  clientId: string,
  fallback: { first_name: string; email: string },
): Promise<{ firstName: string; email: string }[]> {
  const { data } = await serviceSupabase()
    .from('client_users')
    .select('first_name, email')
    .eq('client_id', clientId)
    .neq('status', 'removed');
  const people = (data ?? []).map((p) => ({ firstName: p.first_name, email: p.email }));
  return people.length ? people : [{ firstName: fallback.first_name, email: fallback.email }];
}

async function sendToAll(
  people: { firstName: string; email: string }[],
  build: (firstName: string) => { subject: string; html: string; text: string },
  tag: string,
): Promise<boolean> {
  let anyOk = false;
  for (const person of people) {
    const { ok } = await sendEmail({ to: [person.email], ...build(person.firstName), tag });
    anyOk ||= ok;
  }
  return anyOk;
}

export async function notifyDocumentsRequested(
  actor: Actor,
  clientId: string,
  requestIds: string[],
  options: { note?: string | null; dueDate?: string | null } = {},
): Promise<boolean> {
  const db = serviceSupabase();
  const [{ data: client }, { data: requests }] = await Promise.all([
    db
      .from('clients')
      .select('id, first_name, email, status, invited_at')
      .eq('id', clientId)
      .maybeSingle(),
    db
      .from('document_requests')
      .select('tax_year, business_name, document_types(name, sort_order, requires_front_back)')
      .in('id', requestIds),
  ]);
  if (!client || client.status === 'archived' || !requests?.length) return false;

  const items = requests
    .sort((a, b) => (a.document_types?.sort_order ?? 0) - (b.document_types?.sort_order ?? 0))
    .map((r) => ({
      name: documentLabel(r.document_types),
      taxYear: r.tax_year,
      businessName: r.business_name,
    }));
  const ok = await sendToAll(
    await approvedRecipients(clientId, client),
    (firstName) =>
      documentsRequestedEmail({
        firstName,
        items,
        portalUrl: portalUrl(),
        dueDate: options.dueDate ? formatDate(options.dueDate) : null,
        note: options.note ?? null,
      }),
    'documents_requested',
  );
  if (ok && !client.invited_at) {
    await db.from('clients').update({ invited_at: new Date().toISOString() }).eq('id', clientId);
  }
  await record(actor, ok, 'documents_requested', 'client', clientId);
  return ok;
}

/** Invites one approved user (the client, or someone added for them) to the portal. */
export async function notifyInvite(
  actor: Actor,
  userId: string,
  options: { invitedBy?: string | null } = {},
): Promise<boolean> {
  const db = serviceSupabase();
  const { data: user } = await db
    .from('client_users')
    .select(
      'id, client_id, first_name, last_name, email, status, clients(first_name, last_name, email, status)',
    )
    .eq('id', userId)
    .maybeSingle();
  const client = user?.clients;
  if (!user || user.status === 'removed' || !client || client.status === 'archived') return false;
  const { count } = await db
    .from('document_requests')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', user.client_id)
    .in('status', ['requested', 'redo']);
  const isClientThemselves = user.email === client.email.trim().toLowerCase();
  const email = inviteEmail({
    firstName: user.first_name,
    outstandingCount: count ?? 0,
    portalUrl: portalUrl(),
    accountName: isClientThemselves ? null : `${client.first_name} ${client.last_name}`.trim(),
    invitedBy: options.invitedBy ?? null,
  });
  const { ok } = await sendEmail({ to: [user.email], ...email, tag: 'invite' });
  if (ok) {
    const now = new Date().toISOString();
    await db.from('client_users').update({ invited_at: now }).eq('id', user.id);
    await db.from('clients').update({ invited_at: now }).eq('id', user.client_id);
  }
  await record(actor, ok, 'invite', 'client', user.client_id);
  return ok;
}

export async function notifyRedo(actor: Actor, requestId: string): Promise<boolean> {
  const { data: request } = await serviceSupabase()
    .from('document_requests')
    .select(
      'id, client_id, redo_note, tax_year, clients(first_name, email, status), document_types(name, requires_front_back)',
    )
    .eq('id', requestId)
    .maybeSingle();
  if (!request?.clients || request.clients.status === 'archived' || !request.redo_note)
    return false;
  const name = documentLabel(request.document_types, 'a document');
  const note = request.redo_note;
  const ok = await sendToAll(
    await approvedRecipients(request.client_id, request.clients),
    (firstName) =>
      redoNeededEmail({
        firstName,
        documentName: request.tax_year ? `${name} (${request.tax_year})` : name,
        note,
        portalUrl: portalUrl(),
      }),
    'redo_needed',
  );
  await record(actor, ok, 'redo_needed', 'request', requestId);
  return ok;
}

export async function notifyNewUpload(uploadId: string): Promise<boolean> {
  const { data: upload } = await serviceSupabase()
    .from('uploads')
    .select(
      'id, client_id, clients(first_name, last_name), document_requests(tax_year, document_types(name, requires_front_back))',
    )
    .eq('id', uploadId)
    .maybeSingle();
  if (!upload?.clients) return false;
  let recipients: string[];
  try {
    recipients = adminNotifyRecipients();
  } catch {
    return false;
  }
  const email = newUploadEmail({
    clientName: `${upload.clients.first_name} ${upload.clients.last_name}`,
    documentName: documentLabel(upload.document_requests?.document_types, 'a document'),
    taxYear: upload.document_requests?.tax_year ?? null,
    adminUrl: `${appEnv().APP_BASE_URL}/admin/clients/${upload.client_id}`,
  });
  const { ok } = await sendEmail({
    to: recipients,
    ...email,
    tag: 'new_upload',
    idempotencyKey: `upload-${uploadId}`,
  });
  await record({ actorType: 'system', actorId: null }, ok, 'new_upload', 'upload', uploadId);
  return ok;
}
