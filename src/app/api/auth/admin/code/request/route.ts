import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminEmailLoginEnabled, supabaseEnv } from '@/lib/env';
import { isAllowlisted } from '@/lib/auth/admin-oauth';
import { ensureAuthUser } from '@/lib/clients/auth-user';
import { assertSameOrigin } from '@/lib/security/origin';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';

const bodySchema = z.object({ email: z.email().max(254) });
const MIN_RESPONSE_MS = 600;

/**
 * Backup admin sign-in, step 1: email a one-time code to an allowlisted admin. Disabled
 * unless ADMIN_EMAIL_LOGIN=true. The response is the same for any address, so it does not
 * reveal who is an admin.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!adminEmailLoginEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const meta = metaFromHeaders(request.headers);

  const allowed = await hitLimits([
    [LIMITS.adminCodeRequestPerEmail, email],
    [LIMITS.adminCodeRequestPerIp, meta.ip],
  ]);
  if (!allowed) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.otp_rate_limited',
      metadata: { step: 'admin_request' },
      meta,
    });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (isAllowlisted(email)) {
    try {
      await ensureAuthUser(email);
      const env = supabaseEnv();
      const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await anon.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error)
        log.warn('admin.code_send_failed', {
          statusCode: error.status ?? 0,
          reason: error.code ?? 'unknown',
        });
    } catch (err) {
      log.error('admin.code_send_failed', { reason: (err as Error).name });
    }
  }

  const wait = MIN_RESPONSE_MS + Math.floor(Math.random() * 250) - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return NextResponse.json({ ok: true });
}
