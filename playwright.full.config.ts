import { defineConfig, devices } from '@playwright/test';

/**
 * Full end-to-end run: the production build against local Supabase (`supabase start`:
 * Postgres, Auth, PostgREST, test inbox) and the Graph stand-in (e2e-full/mock-graph.mjs).
 * CI job "Full end-to-end" provides the Supabase URL and keys. Run: npm run test:e2e:full
 */
const PORT = 3200;
const MOCK_PORT = 4010;
const BASE_URL = `http://localhost:${PORT}`;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
process.env.E2E_GRAPH_MOCK_URL = MOCK_URL;

const graph = {
  MS_TENANT_ID: 'e2e-tenant',
  MS_PORTAL_CLIENT_ID: 'e2e-client',
  MS_PORTAL_CLIENT_SECRET: 'e2e-not-a-secret',
  SP_SITE_ID: 'e2e-site',
  SP_DRIVE_ID: 'b!e2e-drive',
  SP_CLIENT_ROOT_FOLDER_ID: 'E2EROOT',
};

export default defineConfig({
  testDir: './e2e-full',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-full' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    ...devices['Pixel 7'],
    permissions: ['camera'],
    launchOptions: {
      // A synthetic camera for the scanner.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: [
    {
      command: 'node e2e-full/mock-graph.mjs',
      url: `${MOCK_URL}/__test/health`,
      reuseExistingServer: false,
      env: { PORT: String(MOCK_PORT), ...graph },
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `${BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        APP_BASE_URL: BASE_URL,
        AUTH_SECRET: 'e2e-only-secret-0123456789abcdef0123456789abcdef',
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        ...graph,
        E2E_GRAPH_MOCK_URL: MOCK_URL,
        ADMIN_ALLOWLIST: process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com',
        ADMIN_EMAIL_LOGIN: 'true',
      },
    },
  ],
});
