import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HMAC-SHA256 signed values for small session cookies.
 *
 * Format: base64url(JSON payload) + "." + base64url(MAC). The cookie name is bound into
 * the MAC so a value issued for one cookie cannot be replayed in another.
 *
 * This module deliberately avoids `server-only` so the proxy can import it.
 */

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set and at least 32 characters');
  }
  return createHmac('sha256', secret).update('qh-portal:signed-cookie:v1').digest();
}

function mac(secret: string, name: string, body: string): string {
  return createHmac('sha256', deriveKey(secret)).update(`${name}.${body}`).digest('base64url');
}

export function signValue(secret: string, name: string, payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${mac(secret, name, body)}`;
}

/** Returns the decoded payload, or null when the value is missing, malformed or tampered. */
export function verifyValue(
  secret: string,
  name: string,
  value: string | undefined | null,
): unknown {
  if (!value || value.length > 4096) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot !== value.lastIndexOf('.')) return null;
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = Buffer.from(mac(secret, name, body), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Keyed hash for identifiers we must not store in plain text (for example rate-limit keys). */
export function keyedHash(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', deriveKey(secret)).update(`${purpose}:${value}`).digest('base64url');
}
