import { describe, expect, it } from 'vitest';
import { HANDOFF_TTL_MS, checkHandoff, handoffUrl, issueHandoff } from '@/lib/auth/handoff';
import {
  CLIENT_ABSOLUTE_MS,
  PHONE_SESSION_MS,
  checkClientSession,
  clientAbsoluteMs,
  issueClientSession,
} from '@/lib/auth/session-policy';
import { classifyPath, phoneAllowed, setupAllowed } from '@/lib/auth/routes';

const SECRET = 'a'.repeat(48);
const UID = '11111111-1111-4111-8111-111111111111';
const RID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const NOW = 1_800_000_000_000;

describe('continue-on-your-phone code', () => {
  it('round-trips for the person and request it was made for', () => {
    const { token, expiresAt } = issueHandoff(SECRET, { authUserId: UID, requestId: RID }, NOW);
    expect(expiresAt).toBe(NOW + HANDOFF_TTL_MS);
    const check = checkHandoff(SECRET, token, NOW + 1000);
    expect(check.ok && check.payload.uid).toBe(UID);
    expect(check.ok && check.payload.rid).toBe(RID);
  });

  it('expires after five minutes', () => {
    const { token } = issueHandoff(SECRET, { authUserId: UID, requestId: RID }, NOW);
    expect(checkHandoff(SECRET, token, NOW + HANDOFF_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a changed code, another secret or nonsense', () => {
    const { token } = issueHandoff(SECRET, { authUserId: UID, requestId: RID }, NOW);
    const flipped = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1);
    expect(checkHandoff(SECRET, flipped, NOW).ok).toBe(false);
    expect(checkHandoff('b'.repeat(48), token, NOW).ok).toBe(false);
    expect(checkHandoff(SECRET, 'not-a-token', NOW).ok).toBe(false);
    expect(checkHandoff(SECRET, null, NOW).ok).toBe(false);
  });

  it('gives each code its own one-time number', () => {
    const a = issueHandoff(SECRET, { authUserId: UID, requestId: RID }, NOW).token;
    const b = issueHandoff(SECRET, { authUserId: UID, requestId: RID }, NOW).token;
    const na = checkHandoff(SECRET, a, NOW);
    const nb = checkHandoff(SECRET, b, NOW);
    expect(na.ok && nb.ok && na.payload.n !== nb.payload.n).toBe(true);
  });

  it('puts the code in the fragment, which browsers never send to a server', () => {
    expect(handoffUrl('https://portal.example.com/', 'abc')).toBe(
      'https://portal.example.com/continue#abc',
    );
  });
});

describe('phone session', () => {
  it('belongs to one request and lasts 30 minutes at most', () => {
    const cookie = issueClientSession(SECRET, UID, 'phone', NOW, RID);
    const ok = checkClientSession(SECRET, cookie, NOW + 10 * 60 * 1000);
    expect(ok.ok && ok.session.m).toBe('phone');
    expect(ok.ok && ok.session.rid).toBe(RID);
    expect(PHONE_SESSION_MS).toBeLessThan(CLIENT_ABSOLUTE_MS);
    expect(clientAbsoluteMs('phone')).toBe(PHONE_SESSION_MS);
    // Kept active, it still ends at 30 minutes.
    const later = checkClientSession(
      SECRET,
      issueClientSession(SECRET, UID, 'phone', NOW - PHONE_SESSION_MS - 1, RID),
      NOW,
    );
    expect(later.ok).toBe(false);
  });

  it('cannot be made without a request, and a full session cannot carry one', () => {
    expect(() => issueClientSession(SECRET, UID, 'phone', NOW)).toThrow();
    expect(() => issueClientSession(SECRET, UID, 'full', NOW, RID)).toThrow();
  });

  it('reaches its own request and the upload API, nothing else', () => {
    expect(phoneAllowed(`/request/${RID}`, RID)).toBe(true);
    expect(phoneAllowed('/api/uploads/start', RID)).toBe(true);
    expect(phoneAllowed('/api/uploads/complete', RID)).toBe(true);
    for (const p of [
      '/',
      `/request/${OTHER}`,
      '/people',
      '/account/setup',
      `/api/uploads/${OTHER}/view`,
      '/api/auth/client/handoff',
    ])
      expect(phoneAllowed(p, RID), p).toBe(false);
    expect(setupAllowed(`/request/${RID}`)).toBe(false);
  });

  it('making a code needs a session; using one does not', () => {
    expect(classifyPath('/api/auth/client/handoff')).toBe('client');
    expect(classifyPath('/api/auth/client/handoff/redeem')).toBe('public');
    expect(classifyPath('/continue')).toBe('public');
  });
});
