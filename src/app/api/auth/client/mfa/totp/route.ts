import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { createUserSupabase } from '@/lib/supabase/server';
import { audit } from '@/lib/audit';
import { findSignInUserByAuthId } from '@/lib/clients/users';
import { TOTP_CODE } from '@/lib/auth/client-mfa';
import { completeFullSignIn } from '@/lib/auth/client-session';
import { safeNextPath } from '@/lib/auth/routes';

const bodySchema = z.object({
  factorId: z.uuid(),
  code: z.string().trim().regex(TOTP_CODE),
  next: z.string().max(512).optional(),
});

/** Step 2 of password sign-in: the code from the person's authenticator app. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const meta = metaFromHeaders(request.headers);
  const supabase = await createUserSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'expired' }, { status: 401 });
  if (
    !(await hitLimits([
      [LIMITS.mfaVerifyPerUser, data.user.id],
      [LIMITS.mfaVerifyPerIp, meta.ip],
    ]))
  ) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const user = await findSignInUserByAuthId(data.user.id);
  if (!user) {
    await supabase.auth.signOut({ scope: 'local' });
    return NextResponse.json({ error: 'expired' }, { status: 401 });
  }

  const verified = await supabase.auth.mfa.challengeAndVerify({
    factorId: input.factorId,
    code: input.code,
  });
  if (verified.error) {
    await audit({
      actorType: 'client',
      actorId: user.id,
      action: 'client.mfa_failed',
      targetType: 'client',
      targetId: user.client_id,
      metadata: { method: 'totp' },
      meta,
    });
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  const next = safeNextPath(input.next ?? null);
  const res = NextResponse.json({
    ok: true,
    redirect: next && !next.startsWith('/admin') ? next : '/',
  });
  if (!(await completeFullSignIn({ supabase, user, method: 'password', res, meta }))) {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return res;
}
