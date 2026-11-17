import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { ipFromHeaders } from '@/lib/request-meta';
import { createUserSupabase } from '@/lib/supabase/server';
import { log } from '@/lib/log';

/** Passkey sign-in, step 1: a challenge for the browser's passkey prompt. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await hitLimits([[LIMITS.passkeyPerIp, ipFromHeaders(request.headers)]]))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const supabase = await createUserSupabase();
  const { data, error } = await supabase.auth.passkey.startAuthentication();
  if (error || !data) {
    log.warn('client.passkey_options_failed', { reason: error?.code ?? 'unknown' });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  return NextResponse.json({ challengeId: data.challenge_id, options: data.options });
}
