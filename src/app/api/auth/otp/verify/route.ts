import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { createUserSupabase } from '@/lib/supabase/server';
import { audit } from '@/lib/audit';
import { SETUP_PATH } from '@/lib/auth/routes';
import { setClientSessionCookie } from '@/lib/auth/client-session';
import { findSignInUserByEmail } from '@/lib/clients/users';

const bodySchema = z.object({
  email: z.email().max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/),
  next: z.string().max(512).optional(),
});

const GENERIC_FAILURE = { error: 'invalid_code' };

/**
 * Verifies an emailed one-time code. The code proves the email address only, so it starts a
 * setup-level session: first-time setup or recovery happens on the setup screen.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json(GENERIC_FAILURE, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const email = input.email.trim().toLowerCase();
  const meta = metaFromHeaders(request.headers);

  const allowed = await hitLimits([
    [LIMITS.otpVerifyPerEmail, email],
    [LIMITS.otpVerifyPerIp, meta.ip],
  ]);
  if (!allowed) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.otp_rate_limited',
      metadata: { step: 'verify' },
      meta,
    });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const user = await findSignInUserByEmail(email);
  const supabase = await createUserSupabase();
  if (!user) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.login_failed',
      metadata: { reason: 'unknown', method: 'code' },
      meta,
    });
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: input.code,
    type: 'email',
  });
  if (error || !data.user || data.user.id !== user.auth_user_id) {
    if (data?.user) await supabase.auth.signOut({ scope: 'local' });
    await audit({
      actorType: 'client',
      actorId: user.id,
      action: 'client.login_failed',
      targetType: 'client',
      targetId: user.client_id,
      metadata: { reason: error?.code ?? 'mismatch', method: 'code' },
      meta,
    });
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  // An emailed code proves the email address only. It starts first-time setup or recovery;
  // the full sign-in happens on the setup screen (passkey, or password + authenticator).
  await audit({
    actorType: 'client',
    actorId: user.id,
    action: 'client.setup_started',
    targetType: 'client',
    targetId: user.client_id,
    meta,
  });
  const res = NextResponse.json({ ok: true, redirect: SETUP_PATH });
  setClientSessionCookie(res, data.user.id, 'setup');
  return res;
}
