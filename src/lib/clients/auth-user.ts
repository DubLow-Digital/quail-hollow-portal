import 'server-only';
import { serviceSupabase } from '@/lib/supabase/admin';

/**
 * Supabase Auth users for clients. Public sign-up is disabled; the portal creates each
 * client's auth user when Aleida adds them, and clients can then sign in with a code.
 */

async function findUserIdByEmail(email: string): Promise<string | null> {
  const auth = serviceSupabase().auth.admin;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await auth.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

export async function ensureAuthUser(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await serviceSupabase().auth.admin.createUser({
    email: normalized,
    email_confirm: true,
  });
  if (data.user) return data.user.id;
  if (error && (error.code === 'email_exists' || error.status === 422)) {
    const existing = await findUserIdByEmail(normalized);
    if (existing) return existing;
  }
  throw error ?? new Error('Could not create the sign-in account');
}

export async function updateAuthEmail(userId: string, email: string): Promise<void> {
  const { error } = await serviceSupabase().auth.admin.updateUserById(userId, {
    email: email.trim().toLowerCase(),
    email_confirm: true,
  });
  if (error) throw error;
}

/** Archived clients cannot sign in. Restoring them lifts the block. */
export async function setSignInBlocked(userId: string, blocked: boolean): Promise<void> {
  const { error } = await serviceSupabase().auth.admin.updateUserById(userId, {
    ban_duration: blocked ? '876000h' : 'none',
  });
  if (error) throw error;
}
