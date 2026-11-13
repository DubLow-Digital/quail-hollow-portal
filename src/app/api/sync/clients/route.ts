import { NextResponse, type NextRequest } from 'next/server';
import { syncConfigured, syncEnv } from '@/lib/env';
import {
  MAX_BODY_BYTES,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  inboundChanges,
  inboundClientSchema,
  normalizeGhlId,
  normalizeNotionId,
  verifyRequest,
} from '@/lib/sync/protocol';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import type { Database } from '@/lib/db/types';

type ClientUpdate = Database['public']['Tables']['clients']['Update'];

const PATH = '/api/sync/clients';
const COLUMNS = 'id, first_name, last_name, phone, email, notion_page_id, ghl_contact_id';
const CHANGE_LABELS: Record<string, string> = {
  first_name: 'first',
  last_name: 'last',
  phone: 'tel',
  notion_page_id: 'notion_link',
  ghl_contact_id: 'ghl_link',
};

/**
 * Called by quail-hollow-sync when a linked Notion client or Lead Alchemist contact
 * changes. Signed with SYNC_HUB_SECRET. It only updates clients that already exist in the
 * portal (new portal clients are created by Aleida, by hand or through Import), it never
 * changes a client's sign-in email, and it never triggers a sync back (no loops).
 */
export async function POST(request: NextRequest) {
  if (!syncConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const meta = metaFromHeaders(request.headers);

  const allowed = await hitLimits([[LIMITS.syncInboundPerIp, meta.ip ?? 'unknown']]);
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'too_large' }, { status: 413 });

  const check = verifyRequest(
    syncEnv().SYNC_HUB_SECRET,
    'POST',
    PATH,
    raw,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
  );
  if (!check.ok) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'sync.rejected',
      metadata: { reason: check.reason },
      meta,
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = inboundClientSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const { origin, client: incoming } = parsed.data;
  const notionId = normalizeNotionId(incoming.notion_page_id);
  const ghlId = normalizeGhlId(incoming.ghl_contact_id);
  const email = incoming.email?.trim().toLowerCase() ?? null;

  // Match on the strongest identifier available.
  const db = serviceSupabase();
  type Row = {
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string;
    notion_page_id: string | null;
    ghl_contact_id: string | null;
  };
  let match: Row | null = null;
  type MatchKey = 'portal_id' | 'notion' | 'ghl' | 'email';
  let matchedBy: MatchKey | null = null;
  const lookups: [
    MatchKey,
    'id' | 'notion_page_id' | 'ghl_contact_id' | 'email',
    string | null | undefined,
  ][] = [
    ['portal_id', 'id', incoming.portal_id],
    ['notion', 'notion_page_id', notionId],
    ['ghl', 'ghl_contact_id', ghlId],
    ['email', 'email', email],
  ];
  for (const [by, column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await db
      .from('clients')
      .select(COLUMNS)
      .eq(column, value)
      .maybeSingle();
    if (error) {
      log.error('sync.inbound_lookup_failed', { reason: error.code });
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
    if (data) {
      match = data as Row;
      matchedBy = by;
      break;
    }
  }
  if (!match) return NextResponse.json({ ok: true, result: 'not_found' });

  // A record found by email must really be the same person in the other system: never
  // re-point an existing link to a different Notion page or contact.
  const update: ClientUpdate = { ...inboundChanges(match, incoming) };
  if (notionId && !match.notion_page_id) update.notion_page_id = notionId;
  if (ghlId && !match.ghl_contact_id) update.ghl_contact_id = ghlId;
  if (
    (notionId && match.notion_page_id && match.notion_page_id !== notionId) ||
    (ghlId && match.ghl_contact_id && match.ghl_contact_id !== ghlId)
  ) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'sync.rejected',
      targetType: 'client',
      targetId: match.id,
      metadata: { reason: 'link_conflict', origin },
      meta,
    });
    return NextResponse.json({ ok: false, result: 'conflict' }, { status: 409 });
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, result: 'unchanged' });

  const { error } = await db.from('clients').update(update).eq('id', match.id);
  if (error) {
    log.error('sync.inbound_update_failed', { clientId: match.id, reason: error.code });
    return NextResponse.json(
      { error: error.code === '23505' ? 'already_linked' : 'unavailable' },
      { status: error.code === '23505' ? 409 : 503 },
    );
  }
  await audit({
    actorType: 'system',
    actorId: null,
    action: 'sync.received',
    targetType: 'client',
    targetId: match.id,
    // Field labels only (the audit sanitizer drops keys that look like personal data).
    metadata: {
      origin,
      matched_by: matchedBy,
      changed: Object.keys(update)
        .map((k) => CHANGE_LABELS[k] ?? 'other')
        .join('+'),
    },
    meta,
  });
  return NextResponse.json({ ok: true, result: 'updated', portal_id: match.id });
}
