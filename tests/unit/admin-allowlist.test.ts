import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/env';
import { isAllowlisted } from '@/lib/auth/admin-oauth';
import { adminEmailLoginEnabled } from '@/lib/env';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetEnvCacheForTests();
});

describe('admin allowlist', () => {
  it('works without the Microsoft admin-app settings', () => {
    delete process.env.MS_ADMIN_CLIENT_ID;
    delete process.env.MS_ADMIN_CLIENT_SECRET;
    process.env.ADMIN_ALLOWLIST = 'Admin@Example.test, second@example.test';
    resetEnvCacheForTests();
    expect(isAllowlisted('admin@example.test')).toBe(true);
    expect(isAllowlisted(' SECOND@example.test ')).toBe(true);
    expect(isAllowlisted('someone@example.test')).toBe(false);
  });
});

describe('backup email-code admin sign-in flag', () => {
  it('is off unless explicitly "true"', () => {
    delete process.env.ADMIN_EMAIL_LOGIN;
    expect(adminEmailLoginEnabled()).toBe(false);
    process.env.ADMIN_EMAIL_LOGIN = '1';
    expect(adminEmailLoginEnabled()).toBe(false);
    process.env.ADMIN_EMAIL_LOGIN = 'true';
    expect(adminEmailLoginEnabled()).toBe(true);
  });
});
