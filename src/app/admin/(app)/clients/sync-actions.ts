'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';
import { str, UUID_RE, type ActionState } from '@/lib/actions';
import { ensureAuthUser } from '@/lib/clients/auth-user';
import { requestMeta } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { log } from '@/lib/log';
import { syncConfigured } from '@/lib/env';
import { HubError, SYNC_ERROR_MESSAGES, getCandidate, pushClient } from '@/lib/sync/hub';
import { entityTypesFor, normalizeGhlId, normalizeNotionId } from '@/lib/sync/protocol';

/** "Sync now" on a client profile: pushes the client and reports the result. */
export async function syncClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const clientId = str(form, 'client_id');
  if (!UUID_RE.test(clientId)) return { ok: false, message: 'Unknown client.' };
  if (!syncConfigured())
    return { ok: false, message: 'Notion and Lead Alchemist sync is not set up yet.' };
  const r = await pushClient(clientId, admin.aid);
  revalidatePath(`/admin/clients/${clientId}`);
  if (r.ok) return { ok: true, message: 'Synced with Notion and Lead Alchemist.' };
  return { ok: false, message: SYNC_ERROR_MESSAGES[r.code] ?? 'Sync failed. Please try again.' };
}

const importSchema = z.object({
  source: z.enum(['notion', 'ghl']),
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
});

const nameSchema = z.string().trim().min(1).max(100);
const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+().\-\s]*$/);

/**
 * Imports one Notion client or Lead Alchemist contact as a portal client. The record is
 * fetched again from the sync service by ID, so nothing posted from the browser is trusted.
 * No invite is sent: Aleida reviews the profile and sends the invite when ready.
 */
export async function importClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = importSchema.safeParse({ source: str(form, 'source'), id: str(form, 'id') });
  if (!parsed.success) return { ok: false, message: 'Choose a record to import.' };
  if (!syncConfigured())
    return { ok: false, message: 'Notion and Lead Alchemist sync is not set up yet.' };
  const { source, id } = parsed.data;

  let candidate;
  try {
    candidate = await getCandidate(source, id);
  } catch (err) {
    const code = err instanceof HubError ? err.code : 'unexpected';
    return { ok: false, message: SYNC_ERROR_MESSAGES[code] ?? 'The record could not be loaded.' };
  }
  if (!candidate) return { ok: false, message: 'That record no longer exists.' };

  const email = z.email().max(254).safeParse(candidate.email?.trim().toLowerCase());
  if (!email.success)
    return {
      ok: false,
      message: 'This record has no valid email address, which clients need to sign in.',
    };
  const first = nameSchema.safeParse(candidate.first_name);
  const last = nameSchema.safeParse(candidate.last_name);
  if (!first.success || !last.success)
    return {
      ok: false,
      message:
        'This record needs a first and last name. Add them at the source, or add the client by hand.',
    };
  const phone = phoneSchema.safeParse(candidate.phone ?? '');

  const notionId = normalizeNotionId(
    candidate.notion_page_id ?? (source === 'notion' ? candidate.id : null),
  );
  const ghlId = normalizeGhlId(
    candidate.ghl_contact_id ?? (source === 'ghl' ? candidate.id : null),
  );

  const db = serviceSupabase();
  const checks: ['email' | 'notion_page_id' | 'ghl_contact_id', string | null][] = [
    ['email', email.data],
    ['notion_page_id', notionId],
    ['ghl_contact_id', ghlId],
  ];
  for (const [column, value] of checks) {
    if (!value) continue;
    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq(column, value)
      .maybeSingle();
    if (existing) return { ok: false, message: 'This person is already in the portal.' };
  }

  let authUserId: string;
  try {
    authUserId = await ensureAuthUser(email.data);
  } catch (err) {
    log.error('client.auth_user_failed', { reason: (err as Error).name });
    return { ok: false, message: 'Could not create the sign-in account. Please try again.' };
  }

  const { data, error } = await db
    .from('clients')
    .insert({
      first_name: first.data,
      last_name: last.data,
      email: email.data,
      phone: phone.success && phone.data ? phone.data : null,
      entity_types: entityTypesFor(candidate.client_type),
      status: 'invited',
      auth_user_id: authUserId,
      notion_page_id: notionId,
      ghl_contact_id: ghlId,
    })
    .select('id')
    .single();
  if (error || !data) {
    log.error('client.import_failed', { reason: error?.code ?? 'unknown' });
    return {
      ok: false,
      message:
        error?.code === '23505'
          ? 'This person is already in the portal.'
          : 'Could not save the client. Please try again.',
    };
  }

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'client.imported',
    targetType: 'client',
    targetId: data.id,
    metadata: { source },
    meta: await requestMeta(),
  });
  // Link (or create) the record in the other system as well.
  const newId = data.id;
  after(() => pushClient(newId, admin.aid));
  redirect(`/admin/clients/${data.id}?imported=1`);
}
