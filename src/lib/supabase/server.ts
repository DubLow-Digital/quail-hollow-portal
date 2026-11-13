import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/db/types';
import { supabaseEnv } from '@/lib/env';
import { SUPABASE_COOKIE_OPTIONS } from './cookie-options';

/**
 * Supabase client acting as the signed-in client (anon key + their session cookie).
 * Every query through this client is subject to row level security.
 */
export async function createUserSupabase() {
  const env = supabaseEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet)
              cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy
            // refreshes the session on the next request, so this is safe to ignore.
          }
        },
      },
    },
  );
}
