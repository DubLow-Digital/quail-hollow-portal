import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { buildContentSecurityPolicy, generateNonce } from '@/lib/security/csp';
import {
  ADMIN_ABSOLUTE_MS,
  ADMIN_SESSION_COOKIE,
  CLIENT_ABSOLUTE_MS,
  CLIENT_SESSION_COOKIE,
  checkAdminSession,
  checkClientSession,
  remainingSeconds,
  sessionCookieOptions,
  touchAdminSession,
  touchClientSession,
} from '@/lib/auth/session-policy';
import { SUPABASE_COOKIE_OPTIONS, isSupabaseAuthCookie } from '@/lib/supabase/cookie-options';
import { classifyPath, safeNextPath } from '@/lib/auth/routes';

/**
 * Runs before every page and API request:
 *  1. Generates a per-request CSP nonce and sets the Content-Security-Policy.
 *  2. Enforces client session limits (30 min idle, 12 h absolute) and refreshes the
 *     Supabase session for client routes.
 *  3. Enforces the admin session cookie for admin routes.
 *
 * Server components and route handlers re-check authorization themselves; this is the
 * outer layer, not the only one.
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    sharePointHost: process.env.SP_HOSTNAME,
  });

  const makeNext = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  const { pathname } = request.nextUrl;
  const area = classifyPath(pathname);
  if (area === 'public') return makeNext();

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    return withCsp(new NextResponse('The portal is not configured yet.', { status: 503 }), csp);
  }

  const isApi = pathname.startsWith('/api/');
  const isPageGet = !isApi && request.method === 'GET';

  if (area === 'admin') {
    const check = checkAdminSession(secret, request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
    if (!check.ok) {
      const res = deny(request, {
        isPageGet,
        loginPath: '/admin/signin',
        reason: check.reason,
        csp,
      });
      res.cookies.delete(ADMIN_SESSION_COOKIE);
      return res;
    }
    const res = makeNext();
    res.cookies.set(ADMIN_SESSION_COOKIE, touchAdminSession(secret, check.session), {
      ...sessionCookieOptions,
      maxAge: remainingSeconds(check.session.iat, ADMIN_ABSOLUTE_MS),
    });
    return res;
  }

  // Client area.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return withCsp(new NextResponse('The portal is not configured yet.', { status: 503 }), csp);
  }

  let response = makeNext();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = makeNext();
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }

  const check = checkClientSession(secret, request.cookies.get(CLIENT_SESSION_COOKIE)?.value);
  if (!userId || !check.ok || check.session.uid !== userId) {
    if (userId) {
      // Revoke the refresh token so an expired portal session cannot be revived.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
    const reason = !userId ? 'missing' : check.ok ? 'invalid' : check.reason;
    const res = deny(request, { isPageGet, loginPath: '/login', reason, csp });
    for (const cookie of request.cookies.getAll()) {
      if (isSupabaseAuthCookie(cookie.name)) res.cookies.delete(cookie.name);
    }
    res.cookies.delete(CLIENT_SESSION_COOKIE);
    return res;
  }

  response.cookies.set(CLIENT_SESSION_COOKIE, touchClientSession(secret, check.session), {
    ...sessionCookieOptions,
    maxAge: remainingSeconds(check.session.iat, CLIENT_ABSOLUTE_MS),
  });
  return response;
}

function withCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

function deny(
  request: NextRequest,
  opts: { isPageGet: boolean; loginPath: string; reason: string; csp: string },
): NextResponse {
  if (!opts.isPageGet) {
    return withCsp(
      NextResponse.json({ error: 'unauthorized', reason: opts.reason }, { status: 401 }),
      opts.csp,
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = opts.loginPath;
  url.search = '';
  if (opts.reason === 'idle' || opts.reason === 'expired') url.searchParams.set('expired', '1');
  const next = safeNextPath(request.nextUrl.pathname);
  if (next && next !== '/') url.searchParams.set('next', next);
  return withCsp(NextResponse.redirect(url), opts.csp);
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|brand/).*)',
    },
  ],
};
