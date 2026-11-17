import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { getSetupContext } from '@/lib/auth/setup-context';
import { completeFullSignIn } from '@/lib/auth/client-session';
import { registrationCredentialSchema } from '@/lib/auth/webauthn-json';
import { log } from '@/lib/log';

const bodySchema = z.object({
  challengeId: z.string().min(1).max(200),
  credential: registrationCredentialSchema,
});

/** Saves the new passkey. On first-time setup that completes sign-in. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getSetupContext();
  if (!ctx) return NextResponse.json({ error: 'expired' }, { status: 401 });
  if (!(await hitLimits([[LIMITS.setupPerUser, ctx.user.id]])))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!ctx.canEnroll) return NextResponse.json({ error: 'confirm_first' }, { status: 403 });

  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { error } = await ctx.supabase.auth.passkey.verifyRegistration({
    challengeId: input.challengeId,
    credential: input.credential,
  });
  if (error) {
    log.warn('client.passkey_register_failed', { reason: error.code ?? 'unknown' });
    return NextResponse.json({ error: 'not_saved' }, { status: 400 });
  }

  const meta = metaFromHeaders(request.headers);
  if (ctx.level === 'full') return NextResponse.json({ ok: true, done: true });
  const res = NextResponse.json({ ok: true, done: true, redirect: '/' });
  if (
    !(await completeFullSignIn({
      supabase: ctx.supabase,
      user: ctx.user,
      method: 'passkey',
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
    metadata: { method: 'passkey' },
    meta,
  });
  return res;
}
