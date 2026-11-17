import { afterEach, describe, expect, it } from 'vitest';
import { assertSameOrigin } from '@/lib/security/origin';

const APP = 'https://portal.example.test';

function req(headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(`${APP}/api/auth/logout`),
  } as unknown as Parameters<typeof assertSameOrigin>[0];
}

describe('same-origin check for state-changing requests', () => {
  const saved = process.env.APP_BASE_URL;
  afterEach(() => {
    process.env.APP_BASE_URL = saved;
  });

  it('accepts our own origin and refuses others', () => {
    process.env.APP_BASE_URL = APP;
    expect(assertSameOrigin(req({ origin: APP }))).toBe(true);
    expect(assertSameOrigin(req({ origin: 'https://evil.example' }))).toBe(false);
    expect(
      assertSameOrigin(req({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' })),
    ).toBe(false);
  });

  it('accepts a form post with Origin: null only when the browser says same-origin', () => {
    // Referrer-Policy: no-referrer makes browsers send "null" for plain form posts.
    process.env.APP_BASE_URL = APP;
    expect(assertSameOrigin(req({ origin: 'null', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(assertSameOrigin(req({ origin: 'null', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(assertSameOrigin(req({ origin: 'null' }))).toBe(false);
    expect(assertSameOrigin(req({}))).toBe(false);
    expect(assertSameOrigin(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });
});
