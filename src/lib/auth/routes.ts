/**
 * Route classification shared by the proxy and tests. Pure functions only.
 */

export type RouteArea = 'public' | 'client' | 'admin';

export function classifyPath(pathname: string): RouteArea {
  // Admin sign-in pages and the OAuth endpoints must stay reachable without a session.
  if (pathname === '/admin/signin' || pathname.startsWith('/admin/signin/')) return 'public';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname.startsWith('/api/admin/')) return 'admin';

  if (pathname === '/') return 'client';
  if (pathname === '/request' || pathname.startsWith('/request/')) return 'client';
  if (pathname.startsWith('/api/uploads/')) return 'client';
  if (pathname === '/account' || pathname.startsWith('/account/')) return 'client';
  if (pathname === '/people' || pathname.startsWith('/people/')) return 'client';
  if (pathname.startsWith('/api/auth/client/setup/')) return 'client';
  // Making a "continue on your phone" code needs a session; using one (redeem) does not.
  if (pathname === '/api/auth/client/handoff') return 'client';

  return 'public';
}

/**
 * Where a client session that is only at the `setup` level (signed in with an emailed code)
 * may go: the setup screen and its API. Everything else in the client area needs a full
 * sign-in.
 */
export const SETUP_PATH = '/account/setup';
export function setupAllowed(pathname: string): boolean {
  return pathname === SETUP_PATH || pathname.startsWith('/api/auth/client/setup/');
}

/**
 * Where a `phone` session (signed in from a "continue on your phone" code) may go: the one
 * request it was made for, and the upload API. Everything else sends it back to that request.
 */
export const PHONE_UPLOAD_APIS = [
  '/api/uploads/start',
  '/api/uploads/complete',
  '/api/uploads/fail',
  '/api/uploads/heartbeat',
];
export function phoneAllowed(pathname: string, requestId: string): boolean {
  return pathname === `/request/${requestId}` || PHONE_UPLOAD_APIS.includes(pathname);
}

/**
 * Only allow same-site relative paths as post-login redirect targets, to prevent open
 * redirects. Returns null when the value is not safe.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  if (value.startsWith('/api/')) return null;
  return value;
}
