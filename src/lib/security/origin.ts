import type { NextRequest } from 'next/server';

/**
 * CSRF defense for state-changing route handlers: the request must come from our own
 * origin. Browsers always send Origin on cross-site POSTs. A plain HTML form post (the
 * Sign out buttons) arrives with `Origin: null`, because the portal sends
 * `Referrer-Policy: no-referrer`; for those we rely on Sec-Fetch-Site, which the browser sets
 * and page scripts cannot. Server Actions have their own built-in origin check.
 */
export function assertSameOrigin(request: Pick<NextRequest, 'headers' | 'nextUrl'>): boolean {
  const expected = (process.env.APP_BASE_URL ?? request.nextUrl.origin).replace(/\/+$/, '');
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === expected || origin === request.nextUrl.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
