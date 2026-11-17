import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { getSetupContext } from '@/lib/auth/setup-context';
import { TOTP_CODE } from '@/lib/auth/client-mfa';
import { completeFullSignIn } from '@/lib/auth/client-session';

const bodySchema = z.object({
  factorId: z.uuid(),
  code: z.string().trim().regex(TOTP_CODE),
  /** Finish sign-in now (first-time setup). Recovery sets a new password first. */
  finish: z.boolean().default(false),
});

/**
 * Confirms a code from the authenticator app: either one just added (first-time setup) or the
 * one already set up (recovery: proves it is really them before they change anything).
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getSetupContext();
  if (!ctx) return NextResponse.json({ error: 'expired' }, { status: 401 });
  const meta = metaFromHeaders(request.headers);
  if (
    !(await hitLimits([
      [LIMITS.mfaVerifyPerUser, ctx.user.auth_user_id],
      [LIMITS.mfaVerifyPerIp, meta.ip],
    ]))
  )
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  // Only a factor that belongs to this person: an already verified one, or (when allowed to
  // enroll) the one they are adding now.
  const { data: factors } = await ctx.supabase.auth.mfa.listFactors();
  const factor = (factors?.all ?? []).find(
    (f) => f.id === input.factorId && f.factor_type === 'totp',
  );
  if (!factor || (factor.status !== 'verified' && !ctx.canEnroll))
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });

  const verified = await ctx.supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: input.code,
  });
  if (verified.error) {
    await audit({
      actorType: 'client',
      actorId: ctx.user.id,
      action: 'client.mfa_failed',
      targetType: 'client',
      targetId: ctx.user.client_id,
      metadata: { method: 'totp', step: 'setup' },
      meta,
    });
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  if (input.finish && ctx.level !== 'full') {
    const res = NextResponse.json({ ok: true, done: true, redirect: '/' });
    if (
      !(await completeFullSignIn({
        supabase: ctx.supabase,
        user: ctx.user,
        method: 'password',
        res,
        meta,
      }))
    )
      return NextResponse.json({ error: 'failed' }, { status: 500 });
    await audit({
      actorType: 'client',
      actorId: ctx.user.id,
      action: 'client.setup_completed',
      targetType: 'client',
      targetId: ctx.user.client_id,
      metadata: { method: 'password' },
      meta,
    });
    return res;
  }
  return NextResponse.json({ ok: true, done: ctx.level === 'full' });
}
