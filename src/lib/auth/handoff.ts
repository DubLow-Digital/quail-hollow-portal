import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { signValue, verifyValue } from '@/lib/security/signed-cookie';

/**
 * "Continue on your phone": a fully signed-in client on a computer gets a QR code that opens
 * the same document request on their phone, already signed in.
 *
 * The code carries a signed, short-lived handoff token. It is:
 * - issued only to a full (not setup-level) client session, for one of that client's requests;
 * - valid for HANDOFF_TTL_MS and usable once (the redeem route records its nonce);
 * - bound to the person who asked for it, so the phone signs in as that same person;
 * - put in the URL fragment (`/continue#<token>`), which browsers never send to a server, so it
 *   never reaches request logs. The phone posts it to the redeem route.
 *
 * Pure module (no `server-only`) so it can be unit-tested.
 */

export const HANDOFF_TTL_MS = 5 * 60 * 1000;
const NAME = 'qh-handoff';

const payloadSchema = z.object({
  v: z.literal(1),
  uid: z.uuid(),
  rid: z.uuid(),
  exp: z.number().int(),
  n: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});

export type HandoffPayload = z.infer<typeof payloadSchema>;

export function issueHandoff(
  secret: string,
  opts: { authUserId: string; requestId: string },
  now = Date.now(),
): { token: string; expiresAt: number } {
  const exp = now + HANDOFF_TTL_MS;
  const payload: HandoffPayload = {
    v: 1,
    uid: opts.authUserId,
    rid: opts.requestId,
    exp,
    n: randomBytes(16).toString('base64url'),
  };
  return { token: signValue(secret, NAME, payload), expiresAt: exp };
}

export type HandoffCheck =
  { ok: true; payload: HandoffPayload } | { ok: false; reason: 'invalid' | 'expired' };

export function checkHandoff(
  secret: string,
  token: string | null | undefined,
  now = Date.now(),
): HandoffCheck {
  const parsed = payloadSchema.safeParse(verifyValue(secret, NAME, token));
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const p = parsed.data;
  // A token claiming more than the normal lifetime was not issued by us.
  if (p.exp > now + HANDOFF_TTL_MS + 60_000) return { ok: false, reason: 'invalid' };
  if (p.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload: p };
}

/** The link the QR code opens. */
export function handoffUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/continue#${token}`;
}
