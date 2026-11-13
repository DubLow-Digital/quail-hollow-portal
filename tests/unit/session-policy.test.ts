import { describe, expect, it } from 'vitest';
import {
  ADMIN_ABSOLUTE_MS,
  ADMIN_IDLE_MS,
  CLIENT_ABSOLUTE_MS,
  CLIENT_IDLE_MS,
  checkAdminSession,
  checkClientSession,
  issueAdminSession,
  issueClientSession,
  remainingSeconds,
  touchClientSession,
} from '@/lib/auth/session-policy';

const SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';
const UID = '00000000-0000-4000-8000-0000000000a1';
const T0 = Date.UTC(2026, 10, 12, 15, 0, 0);

describe('client session policy', () => {
  it('uses 30 minutes idle and 12 hours absolute', () => {
    expect(CLIENT_IDLE_MS).toBe(30 * 60 * 1000);
    expect(CLIENT_ABSOLUTE_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('accepts a fresh session', () => {
    const value = issueClientSession(SECRET, UID, T0);
    const check = checkClientSession(SECRET, value, T0 + 60_000);
    expect(check.ok).toBe(true);
  });

  it('expires after 30 minutes idle', () => {
    const value = issueClientSession(SECRET, UID, T0);
    expect(checkClientSession(SECRET, value, T0 + CLIENT_IDLE_MS - 1000).ok).toBe(true);
    expect(checkClientSession(SECRET, value, T0 + CLIENT_IDLE_MS + 1000)).toEqual({
      ok: false,
      reason: 'idle',
    });
  });

  it('activity extends idle but never the 12 hour absolute limit', () => {
    let value = issueClientSession(SECRET, UID, T0);
    let now = T0;
    // Simulate a request every 20 minutes for 13 hours.
    let expiredAt: number | null = null;
    while (now < T0 + 13 * 60 * 60 * 1000) {
      now += 20 * 60 * 1000;
      const check = checkClientSession(SECRET, value, now);
      if (!check.ok) {
        expect(check.reason).toBe('expired');
        expiredAt = now;
        break;
      }
      value = touchClientSession(SECRET, check.session, now);
    }
    expect(expiredAt).not.toBeNull();
    expect(expiredAt! - T0).toBeGreaterThan(CLIENT_ABSOLUTE_MS);
    expect(expiredAt! - T0).toBeLessThanOrEqual(CLIENT_ABSOLUTE_MS + 20 * 60 * 1000);
  });

  it('rejects missing, forged and future-dated values', () => {
    expect(checkClientSession(SECRET, undefined, T0)).toEqual({ ok: false, reason: 'missing' });
    expect(checkClientSession(SECRET, 'garbage', T0)).toEqual({ ok: false, reason: 'invalid' });
    const future = issueClientSession(SECRET, UID, T0 + 10 * 60 * 1000);
    expect(checkClientSession(SECRET, future, T0)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('cannot be used as an admin session', () => {
    const value = issueClientSession(SECRET, UID, T0);
    expect(checkAdminSession(SECRET, value, T0).ok).toBe(false);
  });

  it('caps cookie lifetime at the absolute limit', () => {
    expect(remainingSeconds(T0, CLIENT_ABSOLUTE_MS, T0)).toBe(12 * 60 * 60);
    expect(remainingSeconds(T0, CLIENT_ABSOLUTE_MS, T0 + CLIENT_ABSOLUTE_MS + 5)).toBe(0);
  });
});

describe('admin session policy', () => {
  const admin = {
    aid: '00000000-0000-4000-8000-00000000ad01',
    email: 'admin@example.test',
    name: 'Test Admin',
  };

  it('accepts a fresh admin session and expires on idle', () => {
    const value = issueAdminSession(SECRET, admin, T0);
    expect(checkAdminSession(SECRET, value, T0 + 1000).ok).toBe(true);
    expect(checkAdminSession(SECRET, value, T0 + ADMIN_IDLE_MS + 1000)).toEqual({
      ok: false,
      reason: 'idle',
    });
  });

  it('expires at the absolute limit', () => {
    const value = issueAdminSession(SECRET, admin, T0);
    expect(checkAdminSession(SECRET, value, T0 + ADMIN_ABSOLUTE_MS + 1000).ok).toBe(false);
  });

  it('cannot be used as a client session', () => {
    const value = issueAdminSession(SECRET, admin, T0);
    expect(checkClientSession(SECRET, value, T0).ok).toBe(false);
  });
});
