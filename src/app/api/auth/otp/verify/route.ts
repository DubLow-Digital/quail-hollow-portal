import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { createUserSupabase } from '@/lib/supabase/server';
import { serviceSupabase } from '@/lib/supabase/admin';
import { appEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { safeNextPath } from '@/lib/auth/routes';
import {
  CLIENT_ABSOLUTE_MS,
  CLIENT_SESSION_COOKIE,
  issueClientSession,
  sessionCookieOptions,
} from '@/lib/auth/session-policy';

const bodySchema = z.object({
  email: z.email().max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/),
  next: z.string().max(512).optional(),
});

const GENERIC_FAILURE = { error: 'invalid_code' };

/** Verifies a one-time code, starts the Supabase session and the portal session cookie. */
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

  const db = serviceSupabase();
  const { data: client } = await db
    .from('clients')
    .select('id, status, auth_user_id')
    .eq('email', email)
    .maybeSingle();

  const supabase = await createUserSupabase();
  if (!client || client.status === 'archived' || !client.auth_user_id) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.login_failed',
      metadata: { reason: 'unknown' },
      meta,
    });
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: input.code,
    type: 'email',
  });
  if (error || !data.user || data.user.id !== client.auth_user_id) {
    if (data?.user) await supabase.auth.signOut({ scope: 'local' });
    await audit({
      actorType: 'client',
      actorId: client.id,
      action: 'client.login_failed',
      targetType: 'client',
      targetId: client.id,
      metadata: { reason: error?.code ?? 'mismatch' },
      meta,
    });
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  const now = new Date().toISOString();
  await db
    .from('clients')
    .update({
      last_login_at: now,
      ...(client.status === 'invited' ? { status: 'active' as const } : {}),
    })
    .eq('id', client.id);
  await audit({
    actorType: 'client',
    actorId: client.id,
    action: 'client.login',
    targetType: 'client',
    targetId: client.id,
    meta,
  });

  const next = safeNextPath(input.next ?? null);
  const res = NextResponse.json({
    ok: true,
    redirect: next && !next.startsWith('/admin') ? next : '/',
  });
  res.cookies.set(CLIENT_SESSION_COOKIE, issueClientSession(appEnv().AUTH_SECRET, data.user.id), {
    ...sessionCookieOptions,
    maxAge: Math.floor(CLIENT_ABSOLUTE_MS / 1000),
  });
  return res;
}
