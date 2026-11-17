import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/security/origin';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { createUserSupabase } from '@/lib/supabase/server';
import { audit } from '@/lib/audit';
import { findSignInUserByAuthId } from '@/lib/clients/users';
import { completeFullSignIn } from '@/lib/auth/client-session';
import { safeNextPath } from '@/lib/auth/routes';
import { authenticationCredentialSchema } from '@/lib/auth/webauthn-json';

const bodySchema = z.object({
  challengeId: z.string().min(1).max(200),
  credential: authenticationCredentialSchema,
  next: z.string().max(512).optional(),
});

/** Passkey sign-in, step 2: the signed challenge. A passkey is a full sign-in on its own. */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const meta = metaFromHeaders(request.headers);
  if (!(await hitLimits([[LIMITS.passkeyPerIp, meta.ip]]))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const supabase = await createUserSupabase();
  const { data, error } = await supabase.auth.passkey.verifyAuthentication({
    challengeId: input.challengeId,
    credential: input.credential,
  });
  const authUserId = data?.user?.id;
  const user = authUserId ? await findSignInUserByAuthId(authUserId) : null;
  if (error || !authUserId || !user) {
    if (authUserId) await supabase.auth.signOut({ scope: 'local' });
    await audit({
      actorType: user ? 'client' : 'system',
      actorId: user?.id ?? null,
      action: 'client.login_failed',
      metadata: { method: 'passkey', reason: error ? 'verify_failed' : 'not_approved' },
      meta,
    });
    return NextResponse.json({ error: 'not_recognized' }, { status: 400 });
  }

  const next = safeNextPath(input.next ?? null);
  const res = NextResponse.json({
    ok: true,
    redirect: next && !next.startsWith('/admin') ? next : '/',
  });
  if (!(await completeFullSignIn({ supabase, user, method: 'passkey', res, meta }))) {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return res;
}
