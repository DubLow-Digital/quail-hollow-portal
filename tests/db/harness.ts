import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Creates a throwaway database, applies the Supabase shim and every migration in order,
 * and returns a connected client. Requires TEST_DATABASE_URL pointing at a Postgres
 * server where the user can create databases (CI uses a postgres:16 service).
 */

const root = join(import.meta.dirname, '..', '..');

export function testDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL;
}

export async function createTestDatabase(): Promise<{
  client: pg.Client;
  drop: () => Promise<void>;
}> {
  const baseUrl = testDatabaseUrl();
  if (!baseUrl) throw new Error('TEST_DATABASE_URL is not set');

  const dbName = `qh_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);

  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  await client.query(readFileSync(join(root, 'tests', 'db', 'supabase-shim.sql'), 'utf8'));
  const migrationsDir = join(root, 'supabase', 'migrations');
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  return {
    client,
    drop: async () => {
      await client.end();
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    },
  };
}

type Role = 'anon' | 'authenticated' | 'service_role';

/**
 * Runs `fn` inside a transaction as the given Postgres role with the given JWT subject,
 * the same way PostgREST does for Supabase requests, and always rolls back.
 */
export async function asRole<T>(
  client: pg.Client,
  role: Role,
  sub: string | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    if (sub) {
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    }
    return await fn((sql, params) => client.query(sql, params as unknown[]));
  } finally {
    await client.query('rollback');
  }
}

/** Runs `fn` inside a savepoint and reports the Postgres error code, if any. */
export async function errorCode(
  q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>,
  sql: string,
  params?: unknown[],
): Promise<string | null> {
  await q('savepoint probe');
  try {
    await q(sql, params);
    await q('release savepoint probe');
    return null;
  } catch (err) {
    await q('rollback to savepoint probe');
    return (err as { code?: string }).code ?? 'unknown';
  }
}
