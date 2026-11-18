import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { checkHandoff } from '@/lib/auth/handoff';
import { completeFullSignIn, startSessionForUser } from '@/lib/auth/client-session';
import { findSignInUserByAuthId } from '@/lib/clients/users';
import { getClient } from '@/lib/auth/client';
import { createUserSupabase } from '@/lib/supabase/server';
import { serviceSupabase } from '@/lib/supabase/admin';
import { appEnv } from '@/lib/env';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimit, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';

const bodySchema = z.object({ token: z.string().min(10).max(1024) });

/**
 * The phone opened a "continue on your phone" link. A valid, unexpired, unused code signs the
 * phone in as the same person who made it, and sends them to the same request. The phone's
 * session reaches that one request and its uploads only, for 30 minutes at most (the proxy
 * and the upload API enforce it). A phone already fully signed in as that person keeps its
 * own session.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const meta = metaFromHeaders(request.headers);
  if (!(await hitLimits([[LIMITS.handoffRedeemPerIp, meta.ip]]))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let token: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    token = parsed.data.token;
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const fail = async (
    reason: string,
    userId: string | null = null,
    clientId: string | null = null,
  ) => {
    await audit({
      actorType: userId ? 'client' : 'system',
      actorId: userId,
      action: 'client.login_failed',
      targetType: clientId ? 'client' : null,
      targetId: clientId,
      metadata: { method: 'phone_handoff', reason },
      meta,
    });
    const error =
      reason === 'expired' || reason === 'used' || reason === 'request_closed' ? reason : 'invalid';
    return NextResponse.json({ error }, { status: 400 });
  };

  const check = checkHandoff(appEnv().AUTH_SECRET, token);
  if (!check.ok) return fail(check.reason);
  const { uid, rid, n } = check.payload;

  // Each code works once. The limiter fails closed, so an outage also refuses the code.
  if (!(await hitLimit(LIMITS.handoffUse, n))) return fail('used');

  const user = await findSignInUserByAuthId(uid);
  if (!user) return fail('not_approved');

  // The request must still be this client's and still open.
  const { data: req } = await serviceSupabase()
    .from('document_requests')
    .select('id, client_id, status')
    .eq('id', rid)
    .maybeSingle();
  if (!req || req.client_id !== user.client_id || req.status === 'accepted')
    return fail('request_closed', user.id, user.client_id);

  const next = `/request/${rid}`;
  const existing = await getClient().catch(() => null);
  if (existing?.userId === uid) return NextResponse.json({ ok: true, next });

  const supabase = await createUserSupabase();
  const res = NextResponse.json({ ok: true, next });
  if (
    !(await startSessionForUser(supabase, user)) ||
    !(await completeFullSignIn({
      supabase,
      user,
      method: 'phone_handoff',
      res,
      meta,
      phoneRequestId: rid,
    }))
  ) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return fail('session_failed', user.id, user.client_id);
  }
  return res;
}
