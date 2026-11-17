import 'server-only';
import { cookies } from 'next/headers';
import { appEnv } from '@/lib/env';
import { createUserSupabase } from '@/lib/supabase/server';
import { findSignInUserByAuthId, type SignInUser } from '@/lib/clients/users';
import {
  CLIENT_SESSION_COOKIE,
  checkClientSession,
  type ClientSessionLevel,
} from './session-policy';
import { readSignInSetup, type SignInSetup } from './client-mfa';

/**
 * Who is on the setup screen and what they may do there. Reached with a setup-level session
 * (emailed code) or a full one (managing sign-in options).
 *
 * - First time (nothing set up yet): may create a passkey, or a password plus an
 *   authenticator app.
 * - Recovery (something already set up): must first prove it with the authenticator app
 *   (or simply sign in with their passkey) before changing anything. Someone who lost every
 *   factor calls the office, and Aleida resets their sign-in.
 */
export interface SetupContext {
  supabase: Awaited<ReturnType<typeof createUserSupabase>>;
  user: SignInUser;
  level: ClientSessionLevel;
  setup: SignInSetup;
  hasExisting: boolean;
  /** May add or change a password, authenticator app or passkey right now. */
  canEnroll: boolean;
}

export async function getSetupContext(): Promise<SetupContext | null> {
  const store = await cookies();
  const check = checkClientSession(appEnv().AUTH_SECRET, store.get(CLIENT_SESSION_COOKIE)?.value);
  if (!check.ok) return null;
  const supabase = await createUserSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.id !== check.session.uid) return null;
  const user = await findSignInUserByAuthId(data.user.id);
  if (!user) return null;
  const setup = await readSignInSetup(supabase);
  const hasExisting = setup.totpFactorIds.length > 0 || setup.passkeyCount > 0;
  const elevated = check.session.m === 'full' || setup.aal === 'aal2';
  return {
    supabase,
    user,
    level: check.session.m,
    setup,
    hasExisting,
    canEnroll: !hasExisting || elevated,
  };
}
