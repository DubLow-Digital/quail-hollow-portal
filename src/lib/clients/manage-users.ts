import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ClientUserRole } from '@/lib/db/types';
import { serviceSupabase } from '@/lib/supabase/admin';
import { log } from '@/lib/log';
import { ensureAuthUser, setSignInBlocked } from './auth-user';

/**
 * Adding, removing and resetting approved users. Callers check who may do it (an admin, or
 * the client's primary contact for their own client) before calling these.
 */

export const personSchema = z.object({
  first_name: z.string().trim().min(1, 'Enter a first name.').max(100),
  last_name: z.string().trim().max(100).default(''),
  email: z
    .email('Enter a valid email address.')
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
});
export type PersonInput = z.infer<typeof personSchema>;

export type ManageResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'email_taken' | 'not_found' | 'is_primary' | 'failed' };

export interface ApprovedUser {
  id: string;
  client_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: ClientUserRole;
  status: 'invited' | 'active' | 'removed';
  invited_at: string | null;
  last_login_at: string | null;
  last_login_method: string | null;
  password_set_at: string | null;
}

export async function listApprovedUsers(clientId: string): Promise<ApprovedUser[]> {
  const { data } = await serviceSupabase()
    .from('client_users')
    .select(
      'id, client_id, email, first_name, last_name, role, status, invited_at, last_login_at, last_login_method, password_set_at',
    )
    .eq('client_id', clientId)
    .neq('status', 'removed')
    .order('role', { ascending: false })
    .order('created_at');
  return (data ?? []) as ApprovedUser[];
}

export async function getApprovedUser(userId: string): Promise<ApprovedUser | null> {
  const { data } = await serviceSupabase()
    .from('client_users')
    .select(
      'id, client_id, email, first_name, last_name, role, status, invited_at, last_login_at, last_login_method, password_set_at',
    )
    .eq('id', userId)
    .neq('status', 'removed')
    .maybeSingle();
  return (data as ApprovedUser | null) ?? null;
}

export async function addApprovedUser(opts: {
  clientId: string;
  person: PersonInput;
  role?: ClientUserRole;
  addedByAdmin?: string | null;
  addedByUser?: string | null;
}): Promise<ManageResult> {
  const db = serviceSupabase();
  const { data: taken } = await db
    .from('client_users')
    .select('id')
    .eq('email', opts.person.email)
    .neq('status', 'removed')
    .maybeSingle();
  if (taken) return { ok: false, reason: 'email_taken' };

  let authUserId: string;
  try {
    authUserId = await ensureAuthUser(opts.person.email);
    await setSignInBlocked(authUserId, false);
  } catch (err) {
    log.error('client_user.auth_user_failed', { reason: (err as Error).name });
    return { ok: false, reason: 'failed' };
  }
  const { data, error } = await db
    .from('client_users')
    .insert({
      client_id: opts.clientId,
      email: opts.person.email,
      first_name: opts.person.first_name,
      last_name: opts.person.last_name,
      role: opts.role ?? 'member',
      status: 'invited',
      auth_user_id: authUserId,
      added_by_admin: opts.addedByAdmin ?? null,
      added_by_user: opts.addedByUser ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    log.error('client_user.insert_failed', { reason: error?.code ?? 'unknown' });
    return { ok: false, reason: error?.code === '23505' ? 'email_taken' : 'failed' };
  }
  return { ok: true, userId: data.id };
}

/**
 * Removes an approved user: they can no longer sign in. Their sign-in account is deleted,
 * which ends every session and removes their password, passkeys and authenticator apps.
 * The main contact cannot be removed; make someone else the main contact first.
 */
export async function removeApprovedUser(userId: string): Promise<ManageResult> {
  const db = serviceSupabase();
  const { data: user } = await db
    .from('client_users')
    .select('id, role, auth_user_id')
    .eq('id', userId)
    .neq('status', 'removed')
    .maybeSingle();
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.role === 'primary') return { ok: false, reason: 'is_primary' };
  const { error } = await db
    .from('client_users')
    .update({ status: 'removed', removed_at: new Date().toISOString(), auth_user_id: null })
    .eq('id', userId);
  if (error) return { ok: false, reason: 'failed' };
  if (user.auth_user_id) await deleteAuthUser(user.auth_user_id);
  return { ok: true, userId };
}

/**
 * Starts this person's sign-in over: ends every session and removes their password,
 * passkeys and authenticator apps (for a lost phone, or a suspected compromise). They set up
 * again with an emailed code.
 */
export async function resetApprovedUserSignIn(userId: string): Promise<ManageResult> {
  const db = serviceSupabase();
  const { data: user } = await db
    .from('client_users')
    .select('id, email, auth_user_id')
    .eq('id', userId)
    .neq('status', 'removed')
    .maybeSingle();
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.auth_user_id) await deleteAuthUser(user.auth_user_id);
  let authUserId: string;
  try {
    authUserId = await ensureAuthUser(user.email);
  } catch (err) {
    log.error('client_user.auth_user_failed', { reason: (err as Error).name });
    return { ok: false, reason: 'failed' };
  }
  const { error } = await db
    .from('client_users')
    .update({ auth_user_id: authUserId, password_set_at: null })
    .eq('id', userId);
  return error ? { ok: false, reason: 'failed' } : { ok: true, userId };
}

/** Makes this approved user the client's main contact (the previous one becomes a member). */
export async function makePrimary(userId: string): Promise<ManageResult> {
  const db = serviceSupabase();
  const { data: user } = await db
    .from('client_users')
    .select('id, client_id, role')
    .eq('id', userId)
    .neq('status', 'removed')
    .maybeSingle();
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.role === 'primary') return { ok: true, userId };
  const demote = await db
    .from('client_users')
    .update({ role: 'member' })
    .eq('client_id', user.client_id)
    .eq('role', 'primary')
    .neq('status', 'removed');
  if (demote.error) return { ok: false, reason: 'failed' };
  const promote = await db.from('client_users').update({ role: 'primary' }).eq('id', userId);
  return promote.error ? { ok: false, reason: 'failed' } : { ok: true, userId };
}

/** Blocks or restores sign-in for everyone approved for a client (archive / restore). */
export async function setClientSignInBlocked(clientId: string, blocked: boolean): Promise<void> {
  const { data } = await serviceSupabase()
    .from('client_users')
    .select('auth_user_id')
    .eq('client_id', clientId)
    .neq('status', 'removed');
  for (const row of data ?? []) {
    if (row.auth_user_id) await setSignInBlocked(row.auth_user_id, blocked);
  }
}

async function deleteAuthUser(authUserId: string): Promise<void> {
  const { error } = await serviceSupabase().auth.admin.deleteUser(authUserId);
  if (error && error.status !== 404) {
    log.error('client_user.auth_delete_failed', { reason: error.code ?? 'unknown' });
    // Fall back to blocking sign-in with a random password, so access still ends.
    await serviceSupabase()
      .auth.admin.updateUserById(authUserId, {
        password: randomBytes(32).toString('base64url'),
        ban_duration: '876000h',
      })
      .catch(() => undefined);
  }
}

export const MANAGE_ERRORS: Record<Exclude<ManageResult, { ok: true }>['reason'], string> = {
  email_taken: 'That email can already sign in to the portal (for this or another client).',
  not_found: 'That person was not found.',
  is_primary: 'Make someone else the main contact first.',
  failed: 'Something went wrong. Please try again.',
};
