import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Smoke tests against a production build with placeholder configuration (no Supabase,
 * Graph or email). They cover security headers, CSP, route protection, CSRF checks and
 * the sign-in form. Full-flow tests need a Supabase project and are documented in
 * docs/STATUS.md.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: BASE_URL, trace: 'off' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      APP_BASE_URL: BASE_URL,
      AUTH_SECRET: 'e2e-only-secret-0123456789abcdef0123456789abcdef',
      // Unroutable placeholders: pages must degrade gracefully without a backend.
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
      SP_HOSTNAME: 'example.sharepoint.com',
    },
  },
});
