import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminEmailLoginEnabled, appEnv, supabaseEnv } from '@/lib/env';
import { isAllowlisted } from '@/lib/auth/admin-oauth';
import {
  ADMIN_ABSOLUTE_MS,
  ADMIN_SESSION_COOKIE,
  issueAdminSession,
  sessionCookieOptions,
} from '@/lib/auth/session-policy';
import { assertSameOrigin } from '@/lib/security/origin';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { safeNextPath } from '@/lib/auth/routes';

const bodySchema = z.object({
  email: z.email().max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/),
  next: z.string().max(512).optional(),
});

const FAILURE = { error: 'invalid_code' };

/**
 * Backup admin sign-in, step 2: check the emailed code and start the same signed admin
 * session that Microsoft sign-in uses. No Supabase session is kept for admins.
 */
export async function POST(request: NextRequest) {
  if (!adminEmailLoginEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(FAILURE, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const meta = metaFromHeaders(request.headers);

  const allowed = await hitLimits([
    [LIMITS.adminCodeVerifyPerEmail, email],
    [LIMITS.adminCodeVerifyPerIp, meta.ip],
  ]);
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const deny = async (reason: string) => {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'admin.login_denied',
      metadata: { reason, method: 'email_code' },
      meta,
    });
    return NextResponse.json(FAILURE, { status: 400 });
  };
  if (!isAllowlisted(email)) return deny('not_allowed');

  const env = supabaseEnv();
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    email,
    token: parsed.data.code,
    type: 'email',
  });
  // The code has done its job; end the Supabase session right away.
  if (data?.session) await anon.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (error || data.user?.email?.toLowerCase() !== email) return deny(error?.code ?? 'mismatch');

  const db = serviceSupabase();
  const now = new Date().toISOString();
  const { data: existing } = await db.from('admins').select('id').eq('email', email).maybeSingle();
  const saved = existing
    ? await db
        .from('admins')
        .update({ last_login_at: now })
        .eq('id', existing.id)
        .select('id, display_name')
        .single()
    : await db
        .from('admins')
        .insert({ email, display_name: email.split('@')[0] ?? email, last_login_at: now })
        .select('id, display_name')
        .single();
  if (saved.error || !saved.data)
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });

  await audit({
    actorType: 'admin',
    actorId: saved.data.id,
    action: 'admin.login',
    targetType: 'admin',
    targetId: saved.data.id,
    metadata: { method: 'email_code' },
    meta,
  });

  const next = safeNextPath(parsed.data.next ?? null);
  const res = NextResponse.json({
    ok: true,
    redirect: next?.startsWith('/admin') ? next : '/admin',
  });
  res.cookies.set(
    ADMIN_SESSION_COOKIE,
    issueAdminSession(appEnv().AUTH_SECRET, {
      aid: saved.data.id,
      email,
      name: saved.data.display_name || email,
    }),
    { ...sessionCookieOptions, maxAge: Math.floor(ADMIN_ABSOLUTE_MS / 1000) },
  );
  return res;
}
