import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { getSetupContext } from '@/lib/auth/setup-context';
import { log } from '@/lib/log';

/** Starts creating a passkey for the person on the setup screen. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getSetupContext();
  if (!ctx) return NextResponse.json({ error: 'expired' }, { status: 401 });
  if (!(await hitLimits([[LIMITS.setupPerUser, ctx.user.id]])))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!ctx.canEnroll) return NextResponse.json({ error: 'confirm_first' }, { status: 403 });
  const { data, error } = await ctx.supabase.auth.passkey.startRegistration();
  if (error || !data) {
    log.error('client.passkey_register_start_failed', { reason: error?.code ?? 'unknown' });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  return NextResponse.json({ challengeId: data.challenge_id, options: data.options });
}
