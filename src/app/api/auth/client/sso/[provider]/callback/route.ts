import { NextResponse, type NextRequest } from 'next/server';
import { completeSsoSignIn } from '@/lib/auth/client-oauth';
import { isSsoProvider } from '@/lib/auth/oidc-claims';
import { completeFullSignIn, startSessionForUser } from '@/lib/auth/client-session';
import { CLIENT_OAUTH_COOKIE, clearPortalCookie } from '@/lib/auth/session-policy';
import { findSignInUserByEmail } from '@/lib/clients/users';
import { createUserSupabase } from '@/lib/supabase/server';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';

/**
 * Google or Microsoft sends the person back here. A verified email that belongs to an
 * approved user signs them in fully; anything else returns to the sign-in page with a reason.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const meta = metaFromHeaders(request.headers);
  const back = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/login?sso=${reason}`, request.url), 303);
    clearPortalCookie(res, CLIENT_OAUTH_COOKIE);
    return res;
  };
  if (!isSsoProvider(provider)) return back('unavailable');
  if (!(await hitLimits([[LIMITS.ssoCallbackPerIp, meta.ip]]))) return back('rate_limited');

  const result = await completeSsoSignIn(
    provider,
    request.nextUrl.searchParams,
    request.cookies.get(CLIENT_OAUTH_COOKIE)?.value,
  );
  if (!result.ok) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.login_failed',
      metadata: { method: provider, reason: result.reason },
      meta,
    });
    if (result.reason === 'cancelled') return back('cancelled');
    if (result.reason === 'no_email' || result.reason === 'email_unverified')
      return back('unverified');
    return back('failed');
  }

  const user = await findSignInUserByEmail(result.identity.email);
  if (!user) {
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'client.login_failed',
      metadata: { method: provider, reason: 'not_approved' },
      meta,
    });
    return back('no_match');
  }

  const supabase = await createUserSupabase();
  const target = result.next && !result.next.startsWith('/admin') ? result.next : '/';
  const res = NextResponse.redirect(new URL(target, request.url), 303);
  clearPortalCookie(res, CLIENT_OAUTH_COOKIE);
  if (
    !(await startSessionForUser(supabase, user)) ||
    !(await completeFullSignIn({ supabase, user, method: provider, res, meta }))
  ) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return back('failed');
  }
  return res;
}
