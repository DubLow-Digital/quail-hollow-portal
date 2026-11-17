/**
 * ID token checks for client sign-in with Google or Microsoft. Pure functions, unit tested.
 *
 * The ID token comes straight from the provider's token endpoint over HTTPS, in exchange for
 * a one-time code plus our client secret and PKCE verifier, so TLS authenticates the issuer
 * (OpenID Connect Core 3.1.3.7, step 6) and the signature is not re-checked. Everything else
 * is: issuer, audience, expiry, nonce, and that the email address is verified by the
 * provider. A client is only ever matched by a verified email.
 */

export type SsoProvider = 'google' | 'microsoft';
export const SSO_PROVIDERS: readonly SsoProvider[] = ['google', 'microsoft'];

/** Microsoft's tenant for personal accounts (Outlook.com, Hotmail, Live). */
export const MSA_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const CLOCK_SKEW_S = 120;

export type ClaimFailure =
  | 'malformed'
  | 'bad_issuer'
  | 'bad_audience'
  | 'expired'
  | 'bad_nonce'
  | 'no_email'
  | 'email_unverified';

export interface SsoIdentity {
  provider: SsoProvider;
  /** Stable account ID at the provider (Google `sub`; Microsoft `tid:oid`). */
  subject: string;
  email: string;
  name: string | null;
}

export type ClaimCheck = { ok: true; identity: SsoIdentity } | { ok: false; reason: ClaimFailure };

export function isSsoProvider(value: string): value is SsoProvider {
  return (SSO_PROVIDERS as readonly string[]).includes(value);
}

/** Decodes a JWT's payload without checking its signature (see the note above). */
export function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 16_384) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const isTrue = (v: unknown): boolean => v === true || v === 'true';

function audienceMatches(claims: Record<string, unknown>, clientId: string): boolean {
  const aud = claims.aud;
  if (typeof aud === 'string') return aud === clientId;
  if (Array.isArray(aud)) return aud.includes(clientId) && claims.azp === clientId;
  return false;
}

function timesOk(claims: Record<string, unknown>, now: number): boolean {
  const exp = claims.exp;
  const iat = claims.iat;
  if (typeof exp !== 'number' || typeof iat !== 'number') return false;
  const nowS = Math.floor(now / 1000);
  return exp + CLOCK_SKEW_S > nowS && iat - CLOCK_SKEW_S <= nowS;
}

function cleanEmail(v: unknown): string | null {
  const email = str(v)?.trim().toLowerCase() ?? null;
  return email && email.length <= 254 && EMAIL.test(email) ? email : null;
}

/**
 * Checks an ID token's claims for the given provider. Returns the verified identity, or the
 * first failed check.
 */
export function checkIdTokenClaims(
  provider: SsoProvider,
  claims: Record<string, unknown> | null,
  expected: { clientId: string; nonce: string; now?: number },
): ClaimCheck {
  if (!claims) return { ok: false, reason: 'malformed' };
  const now = expected.now ?? Date.now();
  const name = str(claims.name)?.slice(0, 200) ?? null;

  if (provider === 'google') {
    const iss = str(claims.iss);
    if (!iss || !GOOGLE_ISSUERS.has(iss)) return { ok: false, reason: 'bad_issuer' };
    if (!audienceMatches(claims, expected.clientId)) return { ok: false, reason: 'bad_audience' };
    if (!timesOk(claims, now)) return { ok: false, reason: 'expired' };
    if (claims.nonce !== expected.nonce) return { ok: false, reason: 'bad_nonce' };
    const sub = str(claims.sub);
    if (!sub) return { ok: false, reason: 'malformed' };
    const email = cleanEmail(claims.email);
    if (!email) return { ok: false, reason: 'no_email' };
    if (!isTrue(claims.email_verified)) return { ok: false, reason: 'email_unverified' };
    return { ok: true, identity: { provider, subject: sub, email, name } };
  }

  // Microsoft (work or school, and personal accounts), v2.0 endpoint.
  const tid = str(claims.tid);
  if (!tid || !GUID.test(tid)) return { ok: false, reason: 'malformed' };
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
    return { ok: false, reason: 'bad_issuer' };
  }
  if (!audienceMatches(claims, expected.clientId)) return { ok: false, reason: 'bad_audience' };
  if (!timesOk(claims, now)) return { ok: false, reason: 'expired' };
  if (claims.nonce !== expected.nonce) return { ok: false, reason: 'bad_nonce' };
  const oid = str(claims.oid) ?? str(claims.sub);
  if (!oid) return { ok: false, reason: 'malformed' };
  const email = cleanEmail(claims.email);
  if (!email) return { ok: false, reason: 'no_email' };
  // Personal Microsoft accounts: the email is the account itself. Work or school accounts:
  // only when Microsoft says the email's domain is verified by that organization
  // (optional claim xms_edov), so nobody can claim an address they do not own.
  const verified = tid.toLowerCase() === MSA_CONSUMER_TENANT || isTrue(claims.xms_edov);
  if (!verified) return { ok: false, reason: 'email_unverified' };
  return {
    ok: true,
    identity: { provider, subject: `${tid.toLowerCase()}:${oid}`, email, name },
  };
}
