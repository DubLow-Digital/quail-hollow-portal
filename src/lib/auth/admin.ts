import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appEnv } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase/admin';
import { ADMIN_SESSION_COOKIE, checkAdminSession, type AdminSession } from './session-policy';
import { isAllowlisted } from './admin-oauth';

/**
 * Server-side admin gate. Every admin page, server action and admin API route calls this
 * before touching data. It re-validates the signed session cookie, the allowlist and the
 * admins table, so removing someone from either takes effect immediately.
 */
export async function getAdmin(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const check = checkAdminSession(
    appEnv().AUTH_SECRET,
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (!check.ok) return null;
  if (!isAllowlisted(check.session.email)) return null;
  const { data } = await serviceSupabase()
    .from('admins')
    .select('id')
    .eq('id', check.session.aid)
    .eq('email', check.session.email)
    .maybeSingle();
  return data ? check.session : null;
}

export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getAdmin();
  if (!admin) redirect('/admin/signin');
  return admin;
}
