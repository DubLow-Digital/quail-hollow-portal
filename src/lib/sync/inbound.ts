import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { syncConfigured, syncEnv } from '@/lib/env';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders, type RequestMeta } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { MAX_BODY_BYTES, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from './protocol';

export type SignedSyncRequest =
  { ok: true; json: unknown; meta: RequestMeta } | { ok: false; response: NextResponse };

/**
 * The checks every call from quail-hollow-sync passes before anything else runs: sync
 * configured, rate limit, body size, and the HMAC signature over method, path and body
 * (SYNC_HUB_SECRET, 5 minute window). Rejected signatures are audited.
 */
export async function readSignedSyncRequest(
  request: NextRequest,
  path: string,
): Promise<SignedSyncRequest> {
  const fail = (status: number, error: string): SignedSyncRequest => ({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });
  if (!syncConfigured()) return fail(404, 'not_found');
  const meta = metaFromHeaders(request.headers);

  const allowed = await hitLimits([[LIMITS.syncInboundPerIp, meta.ip ?? 'unknown']]);
  if (!allowed) return fail(429, 'rate_limited');

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return fail(413, 'too_large');
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail(413, 'too_large');

  const check = verifyRequest(
    syncEnv().SYNC_HUB_SECRET,
    'POST',
    path,
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
    return fail(401, 'unauthorized');
  }

  try {
    return { ok: true, json: JSON.parse(raw), meta };
  } catch {
    return fail(400, 'bad_request');
  }
}
