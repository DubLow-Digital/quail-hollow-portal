import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';

/**
 * What a signed-in Supabase user has set up: verified authenticator apps (TOTP factors) and
 * passkeys. Read with the person's own session.
 */
export interface SignInSetup {
  totpFactorIds: string[];
  passkeyCount: number;
  aal: 'aal1' | 'aal2' | null;
}

export async function readSignInSetup(supabase: SupabaseClient<Database>): Promise<SignInSetup> {
  const [factors, passkeys, aal] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.passkey.list().catch(() => ({ data: null })),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  return {
    totpFactorIds: (factors.data?.totp ?? [])
      .filter((f) => f.status === 'verified')
      .map((f) => f.id),
    passkeyCount: passkeys.data?.length ?? 0,
    aal: (aal.data?.currentLevel as 'aal1' | 'aal2' | null | undefined) ?? null,
  };
}

export const TOTP_CODE = /^\d{6}$/;
