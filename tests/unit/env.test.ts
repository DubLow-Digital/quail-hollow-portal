import { describe, expect, it } from 'vitest';
import { resolvedEnv } from '@/lib/env';

describe('resolvedEnv', () => {
  it('uses the branch URL on Vercel previews when APP_BASE_URL is unset', () => {
    const env = resolvedEnv({
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'qh-git-branch.vercel.app',
    });
    expect(env.APP_BASE_URL).toBe('https://qh-git-branch.vercel.app');
  });

  it('never guesses a URL in production', () => {
    const env = resolvedEnv({
      VERCEL_ENV: 'production',
      VERCEL_BRANCH_URL: 'x.vercel.app',
    });
    expect(env.APP_BASE_URL).toBeUndefined();
  });

  it('prefers an explicit APP_BASE_URL', () => {
    const env = resolvedEnv({
      APP_BASE_URL: 'https://secure.example.test',
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'x.vercel.app',
    });
    expect(env.APP_BASE_URL).toBe('https://secure.example.test');
  });

  it('accepts Supabase publishable and secret key names', () => {
    const env = resolvedEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pub',
      SUPABASE_SECRET_KEY: 'sec',
    });
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('pub');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('sec');
  });
});
