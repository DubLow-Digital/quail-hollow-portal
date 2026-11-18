import 'server-only';
import { z } from 'zod';
import type { EntityType } from '@/lib/db/types';
import { serviceSupabase } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import type { RequestMeta } from '@/lib/request-meta';
import { graphEnv } from '@/lib/env';
import { addApprovedUser } from '@/lib/clients/manage-users';
import { notifyInvite } from '@/lib/requests/notify';
import { starterPlan } from '@/lib/requests/starter';
import { firmDateStamp } from '@/lib/naming/filename';
import { subfolderNeedsBusiness } from '@/lib/naming/folders';
import { ensureSharePointLocation } from '@/lib/graph/location';
import { FolderLinkError, createStandardClientFolder } from '@/lib/graph/client-folders';
import {
  entityTypesFor,
  normalizeGhlId,
  normalizeNotionId,
  type InviteRequest,
  type InviteResponse,
} from './protocol';

/**
 * A Notion client just became Active (their first invoice went out) and the sync service
 * asks the portal to take it from there, so Aleida no longer has to:
 *
 *   1. add the client (or find them, if Aleida already added or imported them),
 *      with the Notion contact as the main contact who can sign in;
 *   2. create their SharePoint folder in the standard structure;
 *   3. request the starter documents for their client type (only if nothing was ever
 *      requested from them);
 *   4. email the invite, which lists how many documents are waiting.
 *
 * A client Aleida already added (same email) is linked to the Notion record rather than
 * added twice. It never invites twice or invites someone who already signs in, never
 * touches an archived client, and never re-points a client already linked to a different
 * Notion record. Anything it cannot do safely comes back as
 * needs_review, and the sync service gives Aleida a task instead.
 */

const SYSTEM = { actorType: 'system' as const, actorId: null };
const nameSchema = z.string().trim().min(1).max(100);
const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+().\-\s]*$/);

type ClientRow = {
  id: string;
  status: 'invited' | 'active' | 'archived';
  invited_at: string | null;
  first_name: string;
  last_name: string;
  entity_types: EntityType[];
  notion_page_id: string | null;
  ghl_contact_id: string | null;
  sharepoint_folder_id: string | null;
};
const CLIENT_COLUMNS =
  'id, status, invited_at, first_name, last_name, entity_types, notion_page_id, ghl_contact_id, sharepoint_folder_id';

export class AutoInviteUnavailable extends Error {}

export async function autoInvite(
  input: InviteRequest['client'],
  meta: RequestMeta,
): Promise<InviteResponse> {
  const notionId = normalizeNotionId(input.notion_page_id);
  if (!notionId) throw new AutoInviteUnavailable('notion id');
  const ghlId = normalizeGhlId(input.ghl_contact_id);
  const emailCheck = z.email().max(254).safeParse(input.email?.trim().toLowerCase());
  const email = emailCheck.success ? emailCheck.data : null;
  const db = serviceSupabase();

  // 1. The client: already in the portal, or added now.
  let client: ClientRow | null = null;
  const lookups: ['notion_page_id' | 'ghl_contact_id' | 'email', string | null][] = [
    ['notion_page_id', notionId],
    ['ghl_contact_id', ghlId],
    ['email', email],
  ];
  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await db
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq(column, value)
      .maybeSingle();
    if (error) throw new AutoInviteUnavailable(error.code);
    if (data) {
      client = data as ClientRow;
      break;
    }
  }

  if (client) {
    if (
      (client.notion_page_id && client.notion_page_id !== notionId) ||
      (ghlId && client.ghl_contact_id && client.ghl_contact_id !== ghlId)
    ) {
      return finish(meta, {
        result: 'needs_review',
        reason: 'link_conflict',
        portal_id: client.id,
      });
    }
    const links: { notion_page_id?: string; ghl_contact_id?: string } = {};
    if (!client.notion_page_id) links.notion_page_id = notionId;
    if (ghlId && !client.ghl_contact_id) links.ghl_contact_id = ghlId;
    if (Object.keys(links).length) {
      const { error } = await db.from('clients').update(links).eq('id', client.id);
      if (error) {
        log.error('sync.auto_invite_link_failed', { clientId: client.id, reason: error.code });
        return finish(meta, {
          result: 'needs_review',
          reason: 'link_conflict',
          portal_id: client.id,
        });
      }
    }
    if (client.status === 'archived')
      return finish(meta, { result: 'archived', portal_id: client.id });
    // Invited before, or already signing in: Aleida's setup for them stands.
    if (client.invited_at || client.status === 'active')
      return finish(meta, { result: 'already_invited', portal_id: client.id });
  } else {
    const added = await addClient(input, { notionId, ghlId, email }, meta);
    if ('reason' in added) return finish(meta, { result: 'needs_review', reason: added.reason });
    client = added.client;
  }

  // 2. Folder, 3. starter documents, 4. invite.
  const folder = await ensureFolder(client, meta);
  const starter = await requestStarterDocuments(client, input.company ?? null, meta);
  const invite = await sendInvite(client.id, meta);
  return finish(meta, {
    result: 'invited',
    portal_id: client.id,
    folder,
    requested: starter.requested,
    skipped_business: starter.skippedBusiness,
    invite,
  });
}

async function finish(
  meta: RequestMeta,
  body: Omit<InviteResponse, 'ok'>,
): Promise<InviteResponse> {
  await audit({
    ...SYSTEM,
    action: 'sync.auto_invited',
    targetType: body.portal_id ? 'client' : null,
    targetId: body.portal_id ?? null,
    metadata: {
      result: body.result,
      reason: body.reason ?? null,
      folder: body.folder ?? null,
      requested: body.requested ?? null,
      invite: body.invite ?? null,
    },
    meta,
  });
  return { ok: true, ...body };
}

async function addClient(
  input: InviteRequest['client'],
  ids: { notionId: string; ghlId: string | null; email: string | null },
  meta: RequestMeta,
): Promise<{ client: ClientRow } | { reason: 'email' | 'name' | 'email_taken' | 'link_conflict' }> {
  if (!ids.email) return { reason: 'email' };
  const first = nameSchema.safeParse(input.first_name);
  const last = nameSchema.safeParse(input.last_name);
  if (!first.success || !last.success) return { reason: 'name' };
  const phone = phoneSchema.safeParse(input.phone ?? '');
  const db = serviceSupabase();

  const { data: taken, error: takenError } = await db
    .from('client_users')
    .select('id')
    .eq('email', ids.email)
    .neq('status', 'removed')
    .maybeSingle();
  if (takenError) throw new AutoInviteUnavailable(takenError.code);
  if (taken) return { reason: 'email_taken' };

  const { data, error } = await db
    .from('clients')
    .insert({
      first_name: first.data,
      last_name: last.data,
      email: ids.email,
      phone: phone.success && phone.data ? phone.data : null,
      entity_types: entityTypesFor(input.client_type),
      status: 'invited',
      notion_page_id: ids.notionId,
      ghl_contact_id: ids.ghlId,
    })
    .select(CLIENT_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { reason: 'link_conflict' };
    throw new AutoInviteUnavailable(error?.code ?? 'insert');
  }
  const client = data as ClientRow;

  const user = await addApprovedUser({
    clientId: client.id,
    person: { first_name: first.data, last_name: last.data, email: ids.email },
    role: 'primary',
    addedByAdmin: null,
  });
  if (!user.ok) {
    await db.from('clients').delete().eq('id', client.id);
    if (user.reason === 'email_taken') return { reason: 'email_taken' };
    throw new AutoInviteUnavailable('approved_user');
  }

  await audit({
    ...SYSTEM,
    action: 'client.created',
    targetType: 'client',
    targetId: client.id,
    metadata: { source: 'auto_invite' },
    meta,
  });
  return { client };
}

async function ensureFolder(
  client: ClientRow,
  meta: RequestMeta,
): Promise<NonNullable<InviteResponse['folder']>> {
  if (client.sharepoint_folder_id) return 'linked';
  let driveId: string;
  try {
    await ensureSharePointLocation();
    driveId = graphEnv().SP_DRIVE_ID;
  } catch {
    return 'not_configured';
  }
  try {
    const folder = await createStandardClientFolder(client.first_name, client.last_name);
    const { error } = await serviceSupabase()
      .from('clients')
      .update({
        sharepoint_drive_id: driveId,
        sharepoint_folder_id: folder.id,
        sharepoint_folder_path: folder.relativePath,
        sharepoint_folder_web_url: folder.webUrl,
      })
      .eq('id', client.id);
    if (error) {
      log.error('sync.auto_folder_link_failed', { clientId: client.id, reason: error.code });
      return 'error';
    }
    await audit({
      ...SYSTEM,
      action: 'client.folder_created',
      targetType: 'client',
      targetId: client.id,
      metadata: { source: 'auto_invite' },
      meta,
    });
    return 'created';
  } catch (err) {
    // A folder with this name already exists: it may be this client's, or a namesake's.
    // Aleida links it by hand; the portal never merges two clients' folders on its own.
    if (err instanceof FolderLinkError) return 'exists';
    log.error('sync.auto_folder_failed', { clientId: client.id, reason: (err as Error).name });
    return 'error';
  }
}

async function requestStarterDocuments(
  client: ClientRow,
  company: string | null,
  meta: RequestMeta,
): Promise<{ requested: number; skippedBusiness: number }> {
  const none = { requested: 0, skippedBusiness: 0 };
  const db = serviceSupabase();
  const { count, error: countError } = await db
    .from('document_requests')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id);
  if (countError) throw new AutoInviteUnavailable(countError.code);
  // Aleida already requested something: her list stands.
  if ((count ?? 0) > 0) return none;

  const plan = starterPlan(
    client.entity_types,
    { first_name: client.first_name, last_name: client.last_name, company },
    firmDateStamp(new Date()),
  );
  if (!plan.bundles.length) return none;

  const { data: bundles } = await db
    .from('request_bundles')
    .select('id, name')
    .in('name', plan.bundles);
  if (!bundles?.length) {
    log.warn('sync.auto_bundles_missing', { wanted: plan.bundles.length });
    return none;
  }
  const { data: items } = await db
    .from('request_bundle_items')
    .select('document_type_id')
    .in(
      'bundle_id',
      bundles.map((b) => b.id),
    );
  const typeIds = [...new Set((items ?? []).map((i) => i.document_type_id))];
  if (!typeIds.length) return none;
  const { data: types } = await db
    .from('document_types')
    .select('id, requires_year, target_subfolder, sort_order')
    .in('id', typeIds)
    .eq('active', true)
    .order('sort_order');

  let skippedBusiness = 0;
  const now = new Date().toISOString();
  const rows = [];
  for (const t of types ?? []) {
    const perBusiness = subfolderNeedsBusiness(t.target_subfolder);
    if (perBusiness && !plan.businessName) {
      skippedBusiness++;
      continue;
    }
    rows.push({
      client_id: client.id,
      document_type_id: t.id,
      tax_year: t.requires_year ? plan.taxYear : null,
      business_name: perBusiness ? plan.businessName : null,
      requested_by: null,
      requested_at: now,
      status_changed_at: now,
    });
  }
  if (!rows.length) return { requested: 0, skippedBusiness };

  const { data: created, error } = await db.from('document_requests').insert(rows).select('id');
  if (error || !created) {
    log.error('sync.auto_requests_failed', { clientId: client.id, reason: error?.code ?? 'none' });
    return { requested: 0, skippedBusiness };
  }
  await Promise.all(
    created.map((r) =>
      audit({
        ...SYSTEM,
        action: 'request.created',
        targetType: 'request',
        targetId: r.id,
        metadata: { client_id: client.id, source: 'auto_invite' },
        meta,
      }),
    ),
  );
  return { requested: created.length, skippedBusiness };
}

async function sendInvite(
  clientId: string,
  meta: RequestMeta,
): Promise<NonNullable<InviteResponse['invite']>> {
  const { data: primary } = await serviceSupabase()
    .from('client_users')
    .select('id')
    .eq('client_id', clientId)
    .eq('role', 'primary')
    .neq('status', 'removed')
    .maybeSingle();
  if (!primary) return 'failed';
  const ok = await notifyInvite(SYSTEM, primary.id);
  if (!ok) return 'failed';
  await audit({
    ...SYSTEM,
    action: 'client.invited',
    targetType: 'client',
    targetId: clientId,
    metadata: { source: 'auto_invite' },
    meta,
  });
  return 'sent';
}
