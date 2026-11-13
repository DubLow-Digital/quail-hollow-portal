import { NextResponse, type NextRequest } from 'next/server';
import { completeAdminSignIn } from '@/lib/auth/admin-oauth';
import {
  ADMIN_ABSOLUTE_MS,
  ADMIN_OAUTH_COOKIE,
  ADMIN_SESSION_COOKIE,
  issueAdminSession,
  sessionCookieOptions,
} from '@/lib/auth/session-policy';
import { appEnv } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { metaFromHeaders } from '@/lib/request-meta';
import { log } from '@/lib/log';

/** Microsoft redirects here after sign-in. Matches the redirect URI in docs/entra-setup.md. */
export async function GET(request: NextRequest) {
  const meta = metaFromHeaders(request.headers);
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/admin/signin?error=${reason}`, request.url));
    res.cookies.delete(ADMIN_OAUTH_COOKIE);
    return res;
  };

  let result;
  try {
    result = await completeAdminSignIn(
      request.nextUrl.searchParams,
      request.cookies.get(ADMIN_OAUTH_COOKIE)?.value,
    );
  } catch (err) {
    log.error('admin.signin_failed', { reason: (err as Error).name });
    return fail('unavailable');
  }

  if (!result.ok) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'admin.login_denied',
      metadata: { reason: result.reason },
      meta,
    });
    return fail(
      result.reason === 'not_allowed' || result.reason === 'wrong_tenant' ? 'denied' : 'failed',
    );
  }

  const { identity } = result;
  const db = serviceSupabase();
  const { data: existing, error: lookupError } = await db
    .from('admins')
    .select('id, ms_object_id')
    .eq('email', identity.email)
    .maybeSingle();
  if (lookupError) return fail('unavailable');

  // Bind each allowlisted email to one Entra account. If a different account later
  // presents the same sign-in name, refuse it.
  if (existing?.ms_object_id && existing.ms_object_id !== identity.oid) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'admin.login_denied',
      targetType: 'admin',
      targetId: existing.id,
      metadata: { reason: 'identity_mismatch' },
      meta,
    });
    return fail('denied');
  }

  const now = new Date().toISOString();
  const upsert = existing
    ? await db
        .from('admins')
        .update({ display_name: identity.name, ms_object_id: identity.oid, last_login_at: now })
        .eq('id', existing.id)
        .select('id')
        .single()
    : await db
        .from('admins')
        .insert({
          email: identity.email,
          display_name: identity.name,
          ms_object_id: identity.oid,
          last_login_at: now,
        })
        .select('id')
        .single();
  if (upsert.error || !upsert.data) return fail('unavailable');

  const adminId = upsert.data.id;
  await audit({
    actorType: 'admin',
    actorId: adminId,
    action: 'admin.login',
    targetType: 'admin',
    targetId: adminId,
    meta,
  });

  const res = NextResponse.redirect(
    new URL(result.next?.startsWith('/admin') ? result.next : '/admin', request.url),
  );
  res.cookies.delete(ADMIN_OAUTH_COOKIE);
  res.cookies.set(
    ADMIN_SESSION_COOKIE,
    issueAdminSession(appEnv().AUTH_SECRET, {
      aid: adminId,
      email: identity.email,
      name: identity.name,
    }),
    { ...sessionCookieOptions, maxAge: Math.floor(ADMIN_ABSOLUTE_MS / 1000) },
  );
  return res;
}
