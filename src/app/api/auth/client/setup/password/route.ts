import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { getSetupContext } from '@/lib/auth/setup-context';
import { passwordProblem, PASSWORD_MAX } from '@/lib/auth/password-policy';
import { completeFullSignIn } from '@/lib/auth/client-session';

const bodySchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX) });

/** Sets or changes the password. Finishes sign-in when the authenticator was just confirmed. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getSetupContext();
  if (!ctx) return NextResponse.json({ error: 'expired' }, { status: 401 });
  if (!(await hitLimits([[LIMITS.setupPerUser, ctx.user.id]])))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!ctx.canEnroll) return NextResponse.json({ error: 'confirm_first' }, { status: 403 });

  let password: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    password = parsed.data.password;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const problem = passwordProblem(password, ctx.user.email);
  if (problem)
    return NextResponse.json({ error: 'weak_password', message: problem }, { status: 400 });

  const { error } = await ctx.supabase.auth.updateUser({ password });
  if (error) {
    const weak = error.code === 'weak_password' || error.code === 'same_password';
    return NextResponse.json(
      {
        error: weak ? 'weak_password' : 'failed',
        message: weak ? 'Please choose a different password.' : undefined,
      },
      { status: weak ? 400 : 500 },
    );
  }
  await serviceSupabase()
    .from('client_users')
    .update({ password_set_at: new Date().toISOString() })
    .eq('id', ctx.user.id);

  if (ctx.setup.aal === 'aal2' && ctx.level !== 'full') {
    const res = NextResponse.json({ ok: true, done: true, redirect: '/' });
    const meta = metaFromHeaders(request.headers);
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
    return res;
  }
  return NextResponse.json({ ok: true, done: ctx.level === 'full' });
}
