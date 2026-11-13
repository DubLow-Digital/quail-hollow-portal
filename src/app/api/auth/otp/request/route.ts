import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { hitLimits, LIMITS } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { serviceSupabase } from '@/lib/supabase/admin';
import { supabaseEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';

const bodySchema = z.object({ email: z.email().max(254) });

const MIN_RESPONSE_MS = 600;

/**
 * Sends a one-time sign-in code to a registered client. The response is identical whether
 * or not the email belongs to a client, and takes a similar time, so the endpoint cannot
 * be used to discover who is a client.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let email: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    email = parsed.data.email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const meta = metaFromHeaders(request.headers);
  const allowed = await hitLimits([
    [LIMITS.otpRequestPerEmail, email],
    [LIMITS.otpRequestPerIp, meta.ip],
  ]);
  if (!allowed) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.otp_rate_limited',
      metadata: { step: 'request' },
      meta,
    });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { data: client } = await serviceSupabase()
    .from('clients')
    .select('id, status, auth_user_id')
    .eq('email', email)
    .maybeSingle();

  if (client && client.status !== 'archived' && client.auth_user_id) {
    const env = supabaseEnv();
    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error)
      log.warn('client.otp_send_failed', {
        statusCode: error.status ?? 0,
        reason: error.code ?? 'unknown',
      });
    await audit({
      actorType: 'client',
      actorId: client.id,
      action: 'client.otp_requested',
      targetType: 'client',
      targetId: client.id,
      metadata: { sent: !error },
      meta,
    });
  } else {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.otp_requested',
      metadata: { known: false },
      meta,
    });
  }

  const elapsed = Date.now() - started;
  const wait = MIN_RESPONSE_MS + Math.floor(Math.random() * 250) - elapsed;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return NextResponse.json({ ok: true });
}
