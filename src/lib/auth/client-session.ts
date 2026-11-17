import 'server-only';
import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, SignInMethod } from '@/lib/db/types';
import { appEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import type { RequestMeta } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { decodeJwtPayload } from './oidc-claims';
import {
  CLIENT_ABSOLUTE_MS,
  CLIENT_SESSION_COOKIE,
  type ClientSessionLevel,
  issueClientSession,
  sessionCookieOptions,
} from './session-policy';
import type { SignInUser } from '@/lib/clients/users';

/**
 * Finishing a client sign-in. A sign-in is full when the person used Google, Microsoft, a
 * passkey, or a password plus an authenticator code. Only then is their Supabase session
 * approved in the database (private.full_sessions), which is what lets its token read the
 * client's records. An emailed code alone gives a setup-level session that can only reach
 * the setup screen.
 */

type UserClient = SupabaseClient<Database>;

/** The Supabase session ID inside the current access token. */
export async function currentSessionId(supabase: UserClient): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const claims = decodeJwtPayload(data.session?.access_token);
  const sid = claims?.session_id;
  return typeof sid === 'string' && /^[0-9a-f-]{36}$/i.test(sid) ? sid : null;
}

export function setClientSessionCookie(
  res: NextResponse,
  authUserId: string,
  level: ClientSessionLevel,
): void {
  res.cookies.set(
    CLIENT_SESSION_COOKIE,
    issueClientSession(appEnv().AUTH_SECRET, authUserId, level),
    { ...sessionCookieOptions, maxAge: Math.floor(CLIENT_ABSOLUTE_MS / 1000) },
  );
}

/**
 * Approves the current Supabase session after a full sign-in, records the sign-in and sets
 * the full portal session cookie on `res`. Returns false (and approves nothing) when the
 * session does not belong to `user`.
 */
export async function completeFullSignIn(opts: {
  supabase: UserClient;
  user: SignInUser;
  /** `phone_handoff`: a QR code from the person's own signed-in computer session. */
  method: SignInMethod | 'phone_handoff';
  res: NextResponse;
  meta: RequestMeta;
}): Promise<boolean> {
  const { supabase, user, method, res, meta } = opts;
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.id !== user.auth_user_id) return false;
  const sessionId = await currentSessionId(supabase);
  if (!sessionId) return false;

  const db = serviceSupabase();
  const { error } = await db.rpc('portal_approve_session', {
    p_session_id: sessionId,
    p_auth_user_id: user.auth_user_id,
    p_method: method,
    p_ttl_seconds: Math.floor(CLIENT_ABSOLUTE_MS / 1000),
  });
  if (error) {
    log.error('client.session_approve_failed', { reason: error.code });
    return false;
  }

  const now = new Date().toISOString();
  await db
    .from('client_users')
    .update({
      last_login_at: now,
      // A phone handoff keeps the method the person actually signed in with.
      ...(method === 'phone_handoff' ? {} : { last_login_method: method }),
      ...(user.status === 'invited' ? { status: 'active' as const } : {}),
    })
    .eq('id', user.id);
  await db.from('clients').update({ last_login_at: now }).eq('id', user.client_id);
  await db
    .from('clients')
    .update({ status: 'active' })
    .eq('id', user.client_id)
    .eq('status', 'invited');
  await audit({
    actorType: 'client',
    actorId: user.id,
    action: 'client.login',
    targetType: 'client',
    targetId: user.client_id,
    metadata: { method },
    meta,
  });
  setClientSessionCookie(res, user.auth_user_id, 'full');
  return true;
}

/**
 * Starts a Supabase session for an approved user after Google or Microsoft confirmed their
 * verified email. Uses a one-time server-side token (never emailed, never shown) and checks
 * the session belongs to that user.
 */
export async function startSessionForUser(
  supabase: UserClient,
  user: SignInUser,
): Promise<boolean> {
  const { data, error } = await serviceSupabase().auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash || data.user?.id !== user.auth_user_id) {
    log.error('client.sso_session_failed', { reason: error?.code ?? 'no_token' });
    return false;
  }
  const verified = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (verified.error || verified.data.user?.id !== user.auth_user_id) {
    if (verified.data?.user) await supabase.auth.signOut({ scope: 'local' });
    log.error('client.sso_session_failed', { reason: verified.error?.code ?? 'mismatch' });
    return false;
  }
  return true;
}

/** Withdraws the database approval of the current session (sign-out). */
export async function revokeCurrentSession(supabase: UserClient): Promise<void> {
  const sessionId = await currentSessionId(supabase);
  if (!sessionId) return;
  const { error } = await serviceSupabase().rpc('portal_revoke_session', {
    p_session_id: sessionId,
  });
  if (error) log.error('client.session_revoke_failed', { reason: error.code });
}
