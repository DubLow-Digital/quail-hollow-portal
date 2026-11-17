import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/** Local Supabase (supabase start) and the Graph stand-in. Values come from the CI job. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const MAIL_URL = process.env.SUPABASE_MAIL_URL ?? 'http://127.0.0.1:54324';
export const GRAPH_MOCK = process.env.E2E_GRAPH_MOCK_URL ?? 'http://127.0.0.1:4010';

/** Service-role read for test setup and assertions (never used by the browser). */
export async function adminRest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`rest ${path.split('?')[0]} -> ${res.status}`);
  return (await res.json()) as T;
}

/** A read as a signed-in client, with their own access token (row level security applies). */
export async function clientRest(
  accessToken: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

type MailpitList = { messages?: { ID: string; Created: string; To: { Address: string }[] }[] };

/**
 * Reads the newest sign-in code sent to `email` after `since` from the local Supabase test
 * inbox (Mailpit in current CLI versions, Inbucket in older ones).
 */
export async function latestCode(email: string, since: number): Promise<string> {
  const deadline = Date.now() + 30_000;
  const want = email.toLowerCase();
  while (Date.now() < deadline) {
    const html = (await fromMailpit(want, since)) ?? (await fromInbucket(want, since));
    const code = html ? />\s*(\d{6})\s*</.exec(html)?.[1] : undefined;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in code arrived for ${email}`);
}

async function fromMailpit(email: string, since: number): Promise<string | null> {
  try {
    const list = (await (
      await fetch(`${MAIL_URL}/api/v1/messages?limit=50`)
    ).json()) as MailpitList;
    const hit = (list.messages ?? [])
      .filter((m) => m.To.some((t) => t.Address.toLowerCase() === email))
      .filter((m) => Date.parse(m.Created) >= since)
      .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0];
    if (!hit) return null;
    const msg = (await (await fetch(`${MAIL_URL}/api/v1/message/${hit.ID}`)).json()) as {
      HTML?: string;
      Text?: string;
    };
    return msg.HTML || msg.Text || null;
  } catch {
    return null;
  }
}

async function fromInbucket(email: string, since: number): Promise<string | null> {
  try {
    const box = email.split('@')[0];
    const list = (await (await fetch(`${MAIL_URL}/api/v1/mailbox/${box}`)).json()) as {
      id: string;
      date: string;
    }[];
    const hit = list
      .filter((m) => Date.parse(m.date) >= since)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    if (!hit) return null;
    const msg = (await (await fetch(`${MAIL_URL}/api/v1/mailbox/${box}/${hit.id}`)).json()) as {
      body?: { html?: string; text?: string };
    };
    return msg.body?.html || msg.body?.text || null;
  } catch {
    return null;
  }
}

/** Email -> code sign-in, the same form for clients (/login) and the admin backup sign-in. */
export async function signInWithCode(page: Page, path: string, email: string): Promise<string> {
  await page.goto(path);
  const since = Date.now() - 10_000;
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByLabel('Enter your code')).toBeVisible();
  const code = await latestCode(email, since);
  await page.getByLabel('Enter your code').fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return code;
}

export interface MockFile {
  id: string;
  name: string;
  path: string;
  size: number;
}
export async function mockFiles(): Promise<MockFile[]> {
  return ((await (await fetch(`${GRAPH_MOCK}/__test/files`)).json()) as { files: MockFile[] })
    .files;
}
export async function mockContent(id: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(`${GRAPH_MOCK}/content/${id}`)).arrayBuffer());
}

/** Today's date as the portal stamps filenames (the firm is in Ocala, Eastern time). */
export function firmDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** A plain striped PNG "photo" (no image library needed). */
export function makePng(width = 1200, height = 800): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const band = Math.floor(x / 60) % 2 === 0;
      raw[row + 1 + x * 3] = band ? 30 : 230;
      raw[row + 2 + x * 3] = band ? 60 : 220;
      raw[row + 3 + x * 3] = band ? 45 : 200;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reads the signed-in client's Supabase access token from the session cookies. */
export function accessTokenFromCookies(cookies: { name: string; value: string }[]): string {
  const parts = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  let raw = parts.map((c) => c.value).join('');
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8');
  else raw = decodeURIComponent(raw);
  const token = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!token) throw new Error('No Supabase session cookie');
  return token;
}

/**
 * Waits for a signed-in page; on failure, reports what the browser had (cookie names only,
 * never values) and where it ended up, so a CI failure explains itself.
 */
export async function expectSignedInAt(page: Page, path: string): Promise<void> {
  try {
    await page.waitForURL((u) => u.pathname === path, { timeout: 20_000 });
  } catch (err) {
    const names = (await page.context().cookies()).map((c) => `${c.name}(${c.value.length})`);
    const heading = await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `Expected ${path} after sign-in; at ${page.url()} (h1: ${heading ?? 'none'}); cookies: ${names.join(', ') || 'none'}. ${(err as Error).message.split('\n')[0]}`,
    );
  }
}

/**
 * RFC 6238 time-based code (SHA-1, 30 seconds, 6 digits) from a base32 key, exactly as an
 * authenticator app computes it.
 */
export function totpCode(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('not a base32 key');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const off = h[h.length - 1]! & 0xf;
  const n = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

const usedTotp = new Set<string>();
/** A code not used before (waits for the next 30-second window when needed). */
export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const code = totpCode(secret);
    const key = `${secret}:${code}`;
    if (!usedTotp.has(key)) {
      usedTotp.add(key);
      return code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * First-time setup or recovery: "First time here?" on the sign-in page, then the emailed
 * code. Ends on the setup screen. Returns the code (so tests can check it is never stored).
 */
export async function startClientSetup(page: Page, email: string): Promise<string> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'First time here? Forgot your password?' }).click();
  const since = Date.now() - 10_000;
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByLabel('Enter your code')).toBeVisible();
  const code = await latestCode(email, since);
  await page.getByLabel('Enter your code').fill(code);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/account/setup');
  return code;
}

/** On the setup screen: a password plus an authenticator app. Returns the app's key. */
export async function setUpPasswordAndAuthenticator(page: Page, password: string): Promise<string> {
  await page.getByRole('button', { name: 'Use a password' }).click();
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Type it again').fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  await page.getByLabel('Code from the app').fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'Finish and sign in' }).click();
  return secret;
}

/** Email + password, then the authenticator code. */
export async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
  secret: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Authenticator code').fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Who the Google or Microsoft stand-in signs in next (claims of the ID token). */
export async function setSsoIdentity(
  provider: 'google' | 'microsoft',
  claims: Record<string, unknown> | null,
): Promise<void> {
  const res = await fetch(`${GRAPH_MOCK}/__test/oauth-identity`, {
    method: 'POST',
    body: JSON.stringify({ provider, claims }),
  });
  if (!res.ok) throw new Error(`stand-in refused identity: ${res.status}`);
}
