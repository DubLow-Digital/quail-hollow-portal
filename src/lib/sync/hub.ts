import 'server-only';
import { z } from 'zod';
import { syncConfigured, syncEnv } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import {
  candidateSchema,
  normalizeGhlId,
  normalizeNotionId,
  pushResponseSchema,
  signRequest,
  type Candidate,
} from './protocol';

/**
 * Calls quail-hollow-sync, which creates or updates the matching Notion client and Lead
 * Alchemist contact. Only name, email, phone, entity types and portal status are sent:
 * never documents, notes, SSNs or upload details.
 */

export class HubError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}

async function hubPost<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
  const env = syncEnv();
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signRequest(env.SYNC_HUB_SECRET, 'POST', path, body);
  let res: Response;
  try {
    res = await fetch(`${env.SYNC_HUB_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-QH-Timestamp': timestamp,
        'X-QH-Signature': signature,
      },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new HubError((err as Error).name === 'TimeoutError' ? 'hub_timeout' : 'hub_unreachable');
  }
  if (res.status === 401) throw new HubError('hub_rejected_signature', 401);
  if (res.status === 404) throw new HubError('hub_not_configured', 404);
  if (!res.ok) throw new HubError('hub_error', res.status);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new HubError('hub_bad_response', res.status);
  return parsed.data;
}

export type PushResult =
  | { ok: true; notion: string; ghl: string }
  | { ok: false; code: string }
  | { ok: false; code: 'not_configured' };

/**
 * Sends one client to the sync service and stores the Notion and Lead Alchemist IDs it
 * returns. Never throws. `actorId` is the admin who triggered it (null for automatic runs).
 */
export async function pushClient(clientId: string, actorId: string | null): Promise<PushResult> {
  if (!syncConfigured()) return { ok: false, code: 'not_configured' };
  const db = serviceSupabase();
  const { data: client } = await db
    .from('clients')
    .select(
      'id, first_name, last_name, email, phone, entity_types, status, notion_page_id, ghl_contact_id',
    )
    .eq('id', clientId)
    .maybeSingle();
  if (!client) return { ok: false, code: 'unknown_client' };

  await db.from('clients').update({ sync_state: 'pending' }).eq('id', clientId);
  try {
    const r = await hubPost(
      '/api/portal/client',
      {
        client: {
          portal_id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          email: client.email,
          phone: client.phone,
          entity_types: client.entity_types,
          status: client.status,
          notion_page_id: client.notion_page_id,
          ghl_contact_id: client.ghl_contact_id,
        },
      },
      pushResponseSchema,
    );
    const notionId = normalizeNotionId(r.notion_page_id) ?? client.notion_page_id;
    const ghlId = normalizeGhlId(r.ghl_contact_id) ?? client.ghl_contact_id;
    const partial = r.notion === 'error' || r.ghl === 'error';
    const { error } = await db
      .from('clients')
      .update({
        notion_page_id: notionId,
        ghl_contact_id: ghlId,
        sync_state: partial ? 'error' : 'ok',
        sync_error: partial
          ? r.notion === 'error'
            ? 'notion_failed'
            : 'lead_alchemist_failed'
          : null,
        synced_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    // 23505: another portal client is already linked to that Notion or Lead Alchemist record.
    if (error) throw new HubError(error.code === '23505' ? 'already_linked' : 'save_failed');
    await audit({
      actorType: actorId ? 'admin' : 'system',
      actorId,
      action: 'sync.pushed',
      targetType: 'client',
      targetId: clientId,
      metadata: { notion: r.notion ?? 'skipped', ghl: r.ghl ?? 'skipped' },
    });
    return { ok: true, notion: r.notion ?? 'skipped', ghl: r.ghl ?? 'skipped' };
  } catch (err) {
    const code = err instanceof HubError ? err.code : 'unexpected';
    log.warn('sync.push_failed', {
      clientId,
      reason: code,
      statusCode: err instanceof HubError ? err.status : 0,
    });
    await db
      .from('clients')
      .update({ sync_state: 'error', sync_error: code.replace(/[^a-z_]/g, '_').slice(0, 60) })
      .eq('id', clientId);
    await audit({
      actorType: actorId ? 'admin' : 'system',
      actorId,
      action: 'sync.push_failed',
      targetType: 'client',
      targetId: clientId,
      metadata: { reason: code },
    });
    return { ok: false, code };
  }
}

const candidatesResponse = z.object({
  ok: z.literal(true),
  candidates: z.array(candidateSchema).max(50),
});

/** Searches Notion clients or Lead Alchemist contacts for the import screen. */
export async function searchCandidates(
  source: 'notion' | 'ghl',
  query: string,
): Promise<Candidate[]> {
  const r = await hubPost('/api/portal/candidates', { source, query }, candidatesResponse);
  return r.candidates.filter((c) => c.source === source);
}

/** Fetches one record by ID, so imports never trust values posted from the browser. */
export async function getCandidate(
  source: 'notion' | 'ghl',
  id: string,
): Promise<Candidate | null> {
  const r = await hubPost('/api/portal/candidates', { source, id }, candidatesResponse);
  return r.candidates.find((c) => c.source === source && c.id === id) ?? null;
}

export const SYNC_ERROR_MESSAGES: Record<string, string> = {
  hub_timeout: 'The sync service did not answer in time.',
  hub_unreachable: 'The sync service could not be reached.',
  hub_rejected_signature:
    'The sync service rejected the portal. Check that SYNC_HUB_SECRET matches.',
  hub_not_configured: 'The sync service is not set up for the portal yet.',
  hub_error: 'The sync service reported an error. Check its activity log.',
  hub_bad_response: 'The sync service sent an unexpected reply.',
  notion_failed: 'Notion could not be updated. Check the sync service activity log.',
  lead_alchemist_failed:
    'Lead Alchemist could not be updated. Check the sync service activity log.',
  already_linked:
    'That Notion or Lead Alchemist record is already linked to another portal client.',
  save_failed: 'The links could not be saved.',
  unexpected: 'Something went wrong.',
};
