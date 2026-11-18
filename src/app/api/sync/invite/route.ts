import { NextResponse, type NextRequest } from 'next/server';
import { inviteRequestSchema, normalizeNotionId } from '@/lib/sync/protocol';
import { readSignedSyncRequest } from '@/lib/sync/inbound';
import { AutoInviteUnavailable, autoInvite } from '@/lib/sync/auto-invite';
import { log } from '@/lib/log';

const PATH = '/api/sync/invite';

/**
 * Called by quail-hollow-sync when a Notion client becomes Active (first invoice) and is
 * not in the portal yet. Signed with SYNC_HUB_SECRET. Adds the client, creates their
 * folder, requests the starter documents and emails the invite (see lib/sync/auto-invite).
 * Safe to call again: a client who was already invited is left as is.
 */
export async function POST(request: NextRequest) {
  const signed = await readSignedSyncRequest(request, PATH);
  if (!signed.ok) return signed.response;

  const parsed = inviteRequestSchema.safeParse(signed.json);
  if (!parsed.success || !normalizeNotionId(parsed.data.client.notion_page_id))
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    return NextResponse.json(await autoInvite(parsed.data.client, signed.meta));
  } catch (err) {
    // Only our own error codes are logged; other messages could quote data.
    const reason =
      err instanceof AutoInviteUnavailable ? err.message.slice(0, 40) : (err as Error).name;
    log.error('sync.auto_invite_failed', { reason });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
