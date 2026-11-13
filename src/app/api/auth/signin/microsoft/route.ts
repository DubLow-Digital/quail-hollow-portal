import { NextResponse, type NextRequest } from 'next/server';
import { beginAdminSignIn } from '@/lib/auth/admin-oauth';
import { ADMIN_OAUTH_COOKIE, sessionCookieOptions } from '@/lib/auth/session-policy';
import { log } from '@/lib/log';

/** Starts admin sign-in: sets a short-lived signed state cookie and redirects to Microsoft. */
export async function GET(request: NextRequest) {
  try {
    const { url, cookie } = await beginAdminSignIn(request.nextUrl.searchParams.get('next'));
    const res = NextResponse.redirect(url);
    res.cookies.set(ADMIN_OAUTH_COOKIE, cookie, { ...sessionCookieOptions, maxAge: 600 });
    return res;
  } catch (err) {
    log.error('admin.signin_start_failed', { reason: (err as Error).name });
    return NextResponse.redirect(new URL('/admin/signin?error=unavailable', request.url));
  }
}
