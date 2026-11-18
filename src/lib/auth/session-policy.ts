import { z } from 'zod';
import { signValue, verifyValue } from '@/lib/security/signed-cookie';

/**
 * Session lifetime policy for clients and admins.
 *
 * Supabase Auth issues the client's tokens; this signed companion cookie enforces our own
 * idle and absolute limits (FTC Safeguards: 30 minutes idle, 12 hours absolute for clients).
 * The proxy refreshes `lastSeen` on each request; server code re-checks before reading data.
 *
 * No `server-only` import: the proxy uses this module.
 */

export const CLIENT_IDLE_MS = 30 * 60 * 1000;
export const CLIENT_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** A phone signed in from a "continue on your phone" code: one request, 30 minutes at most. */
export const PHONE_SESSION_MS = 30 * 60 * 1000;
export const ADMIN_IDLE_MS = 60 * 60 * 1000;
export const ADMIN_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === 'production';

/** `__Host-` cookies require HTTPS, so the prefix is used in production only. */
export const CLIENT_SESSION_COOKIE = isProd ? '__Host-qh_cs' : 'qh_cs';
export const ADMIN_SESSION_COOKIE = isProd ? '__Host-qh_as' : 'qh_as';
export const ADMIN_OAUTH_COOKIE = isProd ? '__Host-qh_oauth' : 'qh_oauth';
/** Short-lived state for client sign-in with Google or Microsoft. */
export const CLIENT_OAUTH_COOKIE = isProd ? '__Host-qh_coauth' : 'qh_coauth';

export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
};

/**
 * Removes one of the portal's cookies. Browsers ignore a deletion of a `__Host-` cookie
 * unless it carries the same Secure / Path attributes, so a bare `cookies.delete(name)`
 * would leave the session in place. Use this instead.
 */
export function clearPortalCookie(
  res: { cookies: { set: (name: string, value: string, options: object) => unknown } },
  name: string,
): void {
  res.cookies.set(name, '', { ...sessionCookieOptions, maxAge: 0, expires: new Date(0) });
}

/**
 * `full`: signed in with Google, Microsoft, a passkey, or a password plus an authenticator
 * code. `setup`: signed in with only an emailed code (first-time setup or recovery); such a
 * session can only reach the setup screen and its API, and its database token reads nothing.
 * `phone`: a phone signed in by scanning the "continue on your phone" code from the same
 * person's full session on a computer; it reaches one request (`rid`) and its uploads only,
 * for PHONE_SESSION_MS at most. Cookies issued before levels existed count as `setup`.
 */
export type ClientSessionLevel = 'full' | 'setup' | 'phone';

const clientSessionSchema = z
  .object({
    v: z.literal(1),
    uid: z.uuid(),
    m: z.enum(['full', 'setup', 'phone']).default('setup'),
    /** The one request a `phone` session may reach. */
    rid: z.uuid().optional(),
    iat: z.number().int(),
    lat: z.number().int(),
  })
  .refine((s) => (s.m === 'phone') === Boolean(s.rid), { message: 'rid belongs to phone only' });

const adminSessionSchema = z.object({
  v: z.literal(1),
  aid: z.uuid(),
  email: z.email(),
  name: z.string().max(200),
  iat: z.number().int(),
  lat: z.number().int(),
});

export type ClientSession = z.infer<typeof clientSessionSchema>;
export type AdminSession = z.infer<typeof adminSessionSchema>;

export type SessionCheck<T> =
  { ok: true; session: T } | { ok: false; reason: 'missing' | 'invalid' | 'idle' | 'expired' };

function evaluate<T extends { iat: number; lat: number }>(
  parsed: T | null,
  hadValue: boolean,
  now: number,
  idleMs: number,
  absoluteMs: number,
): SessionCheck<T> {
  if (!parsed) return { ok: false, reason: hadValue ? 'invalid' : 'missing' };
  // Clock skew guard: values from the future are treated as invalid.
  if (parsed.iat > now + 60_000 || parsed.lat > now + 60_000)
    return { ok: false, reason: 'invalid' };
  if (now - parsed.iat > absoluteMs) return { ok: false, reason: 'expired' };
  if (now - parsed.lat > idleMs) return { ok: false, reason: 'idle' };
  return { ok: true, session: parsed };
}

export function issueClientSession(
  secret: string,
  uid: string,
  level: ClientSessionLevel,
  now = Date.now(),
  requestId?: string,
): string {
  if ((level === 'phone') !== Boolean(requestId))
    throw new Error('A phone session needs exactly one request');
  const payload: ClientSession = {
    v: 1,
    uid,
    m: level,
    ...(requestId ? { rid: requestId } : {}),
    iat: now,
    lat: now,
  };
  return signValue(secret, CLIENT_SESSION_COOKIE, payload);
}

/** How long a client session of this level may last in total. */
export function clientAbsoluteMs(level: ClientSessionLevel): number {
  return level === 'phone' ? PHONE_SESSION_MS : CLIENT_ABSOLUTE_MS;
}

export function checkClientSession(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): SessionCheck<ClientSession> {
  const raw = verifyValue(secret, CLIENT_SESSION_COOKIE, value);
  const parsed = clientSessionSchema.safeParse(raw);
  const session = parsed.success ? parsed.data : null;
  return evaluate(
    session,
    Boolean(value),
    now,
    CLIENT_IDLE_MS,
    clientAbsoluteMs(session?.m ?? 'full'),
  );
}

export function touchClientSession(
  secret: string,
  session: ClientSession,
  now = Date.now(),
): string {
  return signValue(secret, CLIENT_SESSION_COOKIE, { ...session, lat: now });
}

export function issueAdminSession(
  secret: string,
  admin: { aid: string; email: string; name: string },
  now = Date.now(),
): string {
  const payload: AdminSession = { v: 1, ...admin, iat: now, lat: now };
  return signValue(secret, ADMIN_SESSION_COOKIE, payload);
}

export function checkAdminSession(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): SessionCheck<AdminSession> {
  const raw = verifyValue(secret, ADMIN_SESSION_COOKIE, value);
  const parsed = adminSessionSchema.safeParse(raw);
  return evaluate(
    parsed.success ? parsed.data : null,
    Boolean(value),
    now,
    ADMIN_IDLE_MS,
    ADMIN_ABSOLUTE_MS,
  );
}

export function touchAdminSession(secret: string, session: AdminSession, now = Date.now()): string {
  return signValue(secret, ADMIN_SESSION_COOKIE, { ...session, lat: now });
}

/** Cookie max-age (seconds) that never outlives the absolute limit. */
export function remainingSeconds(iat: number, absoluteMs: number, now = Date.now()): number {
  return Math.max(0, Math.floor((iat + absoluteMs - now) / 1000));
}
