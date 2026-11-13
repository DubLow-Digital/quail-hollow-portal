import 'server-only';
import { appEnv } from '@/lib/env';
import { keyedHash } from '@/lib/security/signed-cookie';
import { serviceSupabase } from '@/lib/supabase/admin';
import { log } from '@/lib/log';

/**
 * Fixed-window rate limits stored in Postgres (no extra service). Identifiers such as
 * emails and IPs are stored only as keyed hashes. Fails closed: if the limiter cannot be
 * reached, the action is refused.
 */

export interface Limit {
  bucket: string;
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  otpRequestPerEmail: { bucket: 'otp_req_email', max: 5, windowSeconds: 15 * 60 },
  otpRequestPerIp: { bucket: 'otp_req_ip', max: 20, windowSeconds: 60 * 60 },
  otpVerifyPerEmail: { bucket: 'otp_verify_email', max: 10, windowSeconds: 15 * 60 },
  otpVerifyPerIp: { bucket: 'otp_verify_ip', max: 30, windowSeconds: 15 * 60 },
  adminCodeRequestPerEmail: { bucket: 'admin_code_req_email', max: 5, windowSeconds: 15 * 60 },
  adminCodeRequestPerIp: { bucket: 'admin_code_req_ip', max: 10, windowSeconds: 60 * 60 },
  adminCodeVerifyPerEmail: { bucket: 'admin_code_verify_email', max: 5, windowSeconds: 15 * 60 },
  adminCodeVerifyPerIp: { bucket: 'admin_code_verify_ip', max: 20, windowSeconds: 15 * 60 },
  uploadStartPerClient: { bucket: 'upload_start_client', max: 60, windowSeconds: 60 * 60 },
  syncInboundPerIp: { bucket: 'sync_inbound_ip', max: 300, windowSeconds: 15 * 60 },
} as const satisfies Record<string, Limit>;

export async function hitLimit(limit: Limit, identifier: string): Promise<boolean> {
  const key = `${limit.bucket}:${keyedHash(appEnv().AUTH_SECRET, limit.bucket, identifier.toLowerCase())}`;
  try {
    const { data, error } = await serviceSupabase().rpc('rate_limit_hit', {
      p_key: key,
      p_max: limit.max,
      p_window_seconds: limit.windowSeconds,
    });
    if (error) {
      log.error('rate_limit.error', { reason: error.code });
      return false;
    }
    return data === true;
  } catch (err) {
    log.error('rate_limit.error', { reason: (err as Error).name });
    return false;
  }
}

/** Checks several limits; all are counted, and the call is allowed only if all pass. */
export async function hitLimits(checks: [Limit, string | null][]): Promise<boolean> {
  const results = await Promise.all(
    checks.map(([limit, id]) => (id ? hitLimit(limit, id) : Promise.resolve(true))),
  );
  return results.every(Boolean);
}
