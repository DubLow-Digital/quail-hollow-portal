import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appEnv } from '@/lib/env';
import { createUserSupabase } from '@/lib/supabase/server';
import { CLIENT_SESSION_COOKIE, checkClientSession } from './session-policy';

export interface ClientContext {
  userId: string;
  client: { id: string; first_name: string; last_name: string; email: string };
  supabase: Awaited<ReturnType<typeof createUserSupabase>>;
}

/**
 * The signed-in client, or null. Validates the Supabase session with the Auth server, the
 * portal session cookie (idle and absolute limits), and that an active client record
 * belongs to this user. Data reads through `supabase` are limited by RLS.
 */
export async function getClient(): Promise<ClientContext | null> {
  const cookieStore = await cookies();
  const check = checkClientSession(
    appEnv().AUTH_SECRET,
    cookieStore.get(CLIENT_SESSION_COOKIE)?.value,
  );
  if (!check.ok) return null;

  const supabase = await createUserSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== check.session.uid) return null;

  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name, email, status')
    .maybeSingle();
  if (!client || client.status === 'archived') return null;

  return {
    userId: data.user.id,
    client: {
      id: client.id,
      first_name: client.first_name,
      last_name: client.last_name,
      email: client.email,
    },
    supabase,
  };
}

export async function requireClient(): Promise<ClientContext> {
  const ctx = await getClient();
  if (!ctx) redirect('/login');
  return ctx;
}
