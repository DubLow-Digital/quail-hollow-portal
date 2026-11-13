import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { supabaseEnv } from '@/lib/env';

/**
 * Service-role client. Bypasses row level security, so it must only be used in server
 * code after an explicit authorization check (admin session, or ownership checks for
 * client actions). Never import this from a client component.
 */
let cached: SupabaseClient<Database> | null = null;

export function serviceSupabase(): SupabaseClient<Database> {
  if (!cached) {
    const env = supabaseEnv();
    cached = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-client-info': 'qh-portal-server' } },
    });
  }
  return cached;
}
