import 'server-only';
import type { ClientUserRole, ClientUserStatus } from '@/lib/db/types';
import { serviceSupabase } from '@/lib/supabase/admin';

/**
 * Approved users: the people allowed to sign in for a client (the owner, an office manager,
 * a spouse). Reads here use the service role and are only called after the caller's own
 * identity has been verified.
 */

export interface SignInUser {
  id: string;
  client_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: ClientUserRole;
  status: ClientUserStatus;
  auth_user_id: string;
  password_set_at: string | null;
}

const COLUMNS =
  'id, client_id, email, first_name, last_name, role, status, auth_user_id, password_set_at, clients!inner(status)';

type Row = Omit<SignInUser, 'auth_user_id'> & {
  auth_user_id: string | null;
  clients: { status: string } | { status: string }[] | null;
};

function usable(row: Row | null): SignInUser | null {
  if (!row || row.status === 'removed' || !row.auth_user_id) return null;
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  if (!client || client.status === 'archived') return null;
  const { clients: _client, ...user } = row;
  return user as SignInUser;
}

/** The approved user who may sign in with this email, if any. */
export async function findSignInUserByEmail(email: string): Promise<SignInUser | null> {
  const { data } = await serviceSupabase()
    .from('client_users')
    .select(COLUMNS)
    .eq('email', email.trim().toLowerCase())
    .neq('status', 'removed')
    .maybeSingle();
  return usable(data as Row | null);
}

/** The approved user behind a verified Supabase user ID, if any. */
export async function findSignInUserByAuthId(authUserId: string): Promise<SignInUser | null> {
  const { data } = await serviceSupabase()
    .from('client_users')
    .select(COLUMNS)
    .eq('auth_user_id', authUserId)
    .neq('status', 'removed')
    .maybeSingle();
  return usable(data as Row | null);
}

export function displayName(u: { first_name: string; last_name: string; email: string }): string {
  return `${u.first_name} ${u.last_name}`.trim() || u.email;
}
