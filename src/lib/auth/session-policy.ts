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
export const ADMIN_IDLE_MS = 60 * 60 * 1000;
export const ADMIN_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === 'production';

/** `__Host-` cookies require HTTPS, so the prefix is used in production only. */
export const CLIENT_SESSION_COOKIE = isProd ? '__Host-qh_cs' : 'qh_cs';
export const ADMIN_SESSION_COOKIE = isProd ? '__Host-qh_as' : 'qh_as';
export const ADMIN_OAUTH_COOKIE = isProd ? '__Host-qh_oauth' : 'qh_oauth';

export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
};

const clientSessionSchema = z.object({
  v: z.literal(1),
  uid: z.uuid(),
  iat: z.number().int(),
  lat: z.number().int(),
});

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

export function issueClientSession(secret: string, uid: string, now = Date.now()): string {
  const payload: ClientSession = { v: 1, uid, iat: now, lat: now };
  return signValue(secret, CLIENT_SESSION_COOKIE, payload);
}

export function checkClientSession(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): SessionCheck<ClientSession> {
  const raw = verifyValue(secret, CLIENT_SESSION_COOKIE, value);
  const parsed = clientSessionSchema.safeParse(raw);
  return evaluate(
    parsed.success ? parsed.data : null,
    Boolean(value),
    now,
    CLIENT_IDLE_MS,
    CLIENT_ABSOLUTE_MS,
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
