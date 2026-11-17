import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { getSetupContext } from '@/lib/auth/setup-context';
import { log } from '@/lib/log';

/** Starts adding an authenticator app: a QR code and the same key as text. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getSetupContext();
  if (!ctx) return NextResponse.json({ error: 'expired' }, { status: 401 });
  if (!(await hitLimits([[LIMITS.setupPerUser, ctx.user.id]])))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!ctx.canEnroll) return NextResponse.json({ error: 'confirm_first' }, { status: 403 });

  // Clear any half-finished authenticator from an earlier attempt.
  const { data: factors } = await ctx.supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await ctx.supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    issuer: 'Quail Hollow Accounting',
  });
  if (error || !data || data.type !== 'totp') {
    log.error('client.totp_enroll_failed', { reason: error?.code ?? 'unknown' });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return NextResponse.json({
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret,
  });
}
