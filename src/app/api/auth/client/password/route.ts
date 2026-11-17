import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { createUserSupabase } from '@/lib/supabase/server';
import { audit } from '@/lib/audit';
import { findSignInUserByEmail } from '@/lib/clients/users';
import { readSignInSetup } from '@/lib/auth/client-mfa';
import { setClientSessionCookie } from '@/lib/auth/client-session';
import { SETUP_PATH } from '@/lib/auth/routes';

const bodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

const GENERIC = { error: 'invalid_credentials' };

/**
 * Step 1 of password sign-in. A correct password alone never signs anyone in: the next step
 * is an authenticator code. If no authenticator is set up yet, the person finishes setup.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json(GENERIC, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const email = input.email.trim().toLowerCase();
  const meta = metaFromHeaders(request.headers);
  if (
    !(await hitLimits([
      [LIMITS.passwordPerEmail, email],
      [LIMITS.passwordPerIp, meta.ip],
    ]))
  ) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const user = await findSignInUserByEmail(email);
  const supabase = await createUserSupabase();
  const { data, error } = user
    ? await supabase.auth.signInWithPassword({ email, password: input.password })
    : { data: null, error: true };
  if (!user || error || !data?.user || data.user.id !== user.auth_user_id) {
    if (data?.user) await supabase.auth.signOut({ scope: 'local' });
    await audit({
      actorType: user ? 'client' : 'system',
      actorId: user?.id ?? null,
      action: 'client.login_failed',
      targetType: user ? 'client' : null,
      targetId: user?.client_id ?? null,
      metadata: { method: 'password', reason: user ? 'bad_password' : 'unknown' },
      meta,
    });
    return NextResponse.json(GENERIC, { status: 400 });
  }

  const setup = await readSignInSetup(supabase);
  if (setup.totpFactorIds.length === 0) {
    // Password set but no authenticator yet: finish setup before anything else.
    const res = NextResponse.json({ ok: true, redirect: SETUP_PATH });
    setClientSessionCookie(res, data.user.id, 'setup');
    return res;
  }
  return NextResponse.json({ ok: true, step: 'totp', factorId: setup.totpFactorIds[0] });
}
