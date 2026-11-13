import { defineConfig } from 'vitest/config';

// Database tests need TEST_DATABASE_URL (a Postgres 16 server the user can create databases on).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
