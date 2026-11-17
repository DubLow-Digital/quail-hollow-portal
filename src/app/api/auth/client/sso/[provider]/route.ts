import { NextResponse, type NextRequest } from 'next/server';
import { beginSsoSignIn } from '@/lib/auth/client-oauth';
import { isSsoProvider } from '@/lib/auth/oidc-claims';
import { CLIENT_OAUTH_COOKIE, sessionCookieOptions } from '@/lib/auth/session-policy';
import { LIMITS, hitLimits } from '@/lib/security/rate-limit';
import { ipFromHeaders } from '@/lib/request-meta';
import { log } from '@/lib/log';

/** Starts client sign-in with Google or Microsoft (a plain link, so no form-action issues). */
export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/login?sso=${reason}`, request.url), 303);
  if (!isSsoProvider(provider)) return back('unavailable');
  if (!(await hitLimits([[LIMITS.ssoStartPerIp, ipFromHeaders(request.headers)]]))) {
    return back('rate_limited');
  }
  try {
    const started = beginSsoSignIn(provider, request.nextUrl.searchParams.get('next'));
    if (!started) return back('unavailable');
    const res = NextResponse.redirect(started.url, 303);
    res.cookies.set(CLIENT_OAUTH_COOKIE, started.cookie, { ...sessionCookieOptions, maxAge: 600 });
    return res;
  } catch (err) {
    log.error('client.sso_start_failed', { provider, reason: (err as Error).name });
    return back('unavailable');
  }
}
