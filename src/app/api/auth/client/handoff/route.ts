import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getClient } from '@/lib/auth/client';
import { HANDOFF_TTL_MS, handoffUrl, issueHandoff } from '@/lib/auth/handoff';
import { appEnv } from '@/lib/env';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';

const bodySchema = z.object({ requestId: z.uuid() });

/**
 * Creates a "continue on your phone" link for one of the signed-in client's open requests.
 * The link is returned to this browser only (to draw the QR code) and is never logged.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getClient();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (!(await hitLimits([[LIMITS.handoffCreatePerUser, ctx.userId]]))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Row level security returns nothing when the request belongs to another client.
  const { data: req } = await ctx.supabase
    .from('document_requests')
    .select('id, status')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!req || req.status === 'accepted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const env = appEnv();
  const { token, expiresAt } = issueHandoff(env.AUTH_SECRET, {
    authUserId: ctx.userId,
    requestId: req.id,
  });
  await audit({
    actorType: 'client',
    actorId: ctx.user.id,
    action: 'client.phone_handoff_created',
    targetType: 'request',
    targetId: req.id,
    meta: metaFromHeaders(request.headers),
  });
  return NextResponse.json(
    { url: handoffUrl(env.APP_BASE_URL, token), expiresAt, ttlMs: HANDOFF_TTL_MS },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
