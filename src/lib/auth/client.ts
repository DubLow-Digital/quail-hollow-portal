import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appEnv } from '@/lib/env';
import { createUserSupabase } from '@/lib/supabase/server';
import { findSignInUserByAuthId } from '@/lib/clients/users';
import type { ClientUserRole } from '@/lib/db/types';
import { CLIENT_SESSION_COOKIE, checkClientSession } from './session-policy';

export interface ClientContext {
  /** Supabase user ID of the person signed in. */
  userId: string;
  client: { id: string; first_name: string; last_name: string; email: string };
  /** The approved user signed in (the owner, an office manager, a spouse...). */
  user: { id: string; first_name: string; last_name: string; email: string; role: ClientUserRole };
  supabase: Awaited<ReturnType<typeof createUserSupabase>>;
  /**
   * Set when this is a phone signed in from a "continue on your phone" code: the one request
   * it may reach. Null for a full sign-in.
   */
  phoneRequestId: string | null;
}

export interface ClientOptions {
  /** Also accept a phone session (one request only). Callers must then respect phoneRequestId. */
  allowPhone?: boolean;
}

/**
 * The signed-in client, or null. Validates the Supabase session with the Auth server, the
 * portal session cookie (full sign-in, idle and absolute limits), and that this person is a
 * current approved user of an active client. Data reads through `supabase` are limited by
 * RLS, which also requires the session to have been approved after a full sign-in.
 */
export async function getClient(options: ClientOptions = {}): Promise<ClientContext | null> {
  const cookieStore = await cookies();
  const check = checkClientSession(
    appEnv().AUTH_SECRET,
    cookieStore.get(CLIENT_SESSION_COOKIE)?.value,
  );
  if (!check.ok) return null;
  const level = check.session.m;
  if (level !== 'full' && !(level === 'phone' && options.allowPhone)) return null;
  const phoneRequestId = level === 'phone' ? (check.session.rid ?? null) : null;
  if (level === 'phone' && !phoneRequestId) return null;

  const supabase = await createUserSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== check.session.uid) return null;

  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name, email, status')
    .maybeSingle();
  if (!client || client.status === 'archived') return null;
  const user = await findSignInUserByAuthId(data.user.id);
  if (!user || user.client_id !== client.id) return null;

  return {
    userId: data.user.id,
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
    },
    client: {
      id: client.id,
      first_name: client.first_name,
      last_name: client.last_name,
      email: client.email,
    },
    supabase,
    phoneRequestId,
  };
}

export async function requireClient(options: ClientOptions = {}): Promise<ClientContext> {
  const ctx = await getClient(options);
  if (!ctx) redirect('/login');
  return ctx;
}

/** Whether this signed-in client may act on this request (a phone session: only its own). */
export function mayUseRequest(ctx: ClientContext, requestId: string): boolean {
  return ctx.phoneRequestId === null || ctx.phoneRequestId === requestId;
}
