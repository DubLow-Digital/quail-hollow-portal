import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { asRole, createTestDatabase, errorCode } from './harness';

/**
 * Row level security tests. These prove, against a real Postgres with Supabase's default
 * grants reproduced, that a client can only read their own rows and can write nothing.
 * All names are obviously fake.
 */

const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000b2';
const USER_ARCHIVED = '00000000-0000-4000-8000-0000000000c3';
const USER_NO_CLIENT = '00000000-0000-4000-8000-0000000000d4';

let client: pg.Client;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ client, drop } = await createTestDatabase());

  await client.query(
    `insert into auth.users (id, email) values
       ($1, 'test.client@example.test'), ($2, 'pat.example@example.test'),
       ($3, 'archie.archived@example.test'), ($4, 'nobody@example.test')`,
    [USER_A, USER_B, USER_ARCHIVED, USER_NO_CLIENT],
  );

  const admin = await client.query(
    `insert into admins (email, display_name) values ('admin@example.test', 'Test Admin') returning id`,
  );
  ids.admin = admin.rows[0].id;

  const clients = await client.query(
    `insert into clients (first_name, last_name, email, status, auth_user_id, sharepoint_folder_id)
     values ('Test', 'Client', 'test.client@example.test', 'active', $1, 'FOLDER-A'),
            ('Pat', 'Example', 'pat.example@example.test', 'active', $2, 'FOLDER-B'),
            ('Archie', 'Archived', 'archie.archived@example.test', 'archived', $3, 'FOLDER-C')
     returning id, first_name`,
    [USER_A, USER_B, USER_ARCHIVED],
  );
  for (const row of clients.rows) ids[`client_${row.first_name}`] = row.id;

  const types = await client.query(`select id, slug_for_filename from document_types`);
  for (const row of types.rows) ids[`type_${row.slug_for_filename}`] = row.id;

  const reqs = await client.query(
    `insert into document_requests (client_id, document_type_id, status, requested_by)
     values ($1, $2, 'requested', $5),
            ($1, $3, 'uploaded', $5),
            ($4, $2, 'requested', $5),
            ($6, $2, 'requested', $5)
     returning id, client_id`,
    [
      ids.client_Test,
      ids.type_DriversLicense,
      ids.type_W2,
      ids.client_Pat,
      ids.admin,
      ids.client_Archie,
    ],
  );
  ids.req_A1 = reqs.rows[0].id;
  ids.req_A2 = reqs.rows[1].id;
  ids.req_B1 = reqs.rows[2].id;
  ids.req_C1 = reqs.rows[3].id;

  // Only Pat's request references this type; Test Client must not see it.
  await client.query(
    `insert into document_requests (client_id, document_type_id, status) values ($1, $2, 'requested')`,
    [ids.client_Pat, ids.type_EINLetter],
  );

  await client.query(
    `insert into uploads (request_id, client_id, final_filename, target_folder_id, target_folder_path,
                          declared_size_bytes, size_bytes, mime, status, sharepoint_web_url)
     values ($1, $2, 'TClient_W2_2025_2026-11-12.pdf', 'F1', 'Client, Test/Individual', 1000, 1000,
             'application/pdf', 'complete', 'https://example.invalid/a'),
            ($3, $4, 'PExample_DriversLicense_2026-11-12.jpg', 'F2', 'Example, Pat/Individual/ID', 2000, 2000,
             'image/jpeg', 'complete', 'https://example.invalid/b')`,
    [ids.req_A2, ids.client_Test, ids.req_B1, ids.client_Pat],
  );

  await client.query(
    `insert into audit_log (actor_type, actor_id, action, target_type, target_id)
     values ('admin', $1, 'client.created', 'client', $2)`,
    [ids.admin, ids.client_Test],
  );
}, 60_000);

afterAll(async () => {
  await drop?.();
});

describe('clients', () => {
  it('a client sees only their own client record', async () => {
    const rows = await asRole(client, 'authenticated', USER_A, (q) =>
      q('select id, first_name, last_name, email, status from clients'),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].id).toBe(ids.client_Test);
  });

  it('a client cannot look up another client by id', async () => {
    const rows = await asRole(client, 'authenticated', USER_A, (q) =>
      q('select id from clients where id = $1', [ids.client_Pat]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('a client cannot read SharePoint location or auth columns', async () => {
    const code = await asRole(client, 'authenticated', USER_A, (q) =>
      errorCode(q, 'select sharepoint_folder_id from clients'),
    );
    expect(code).toBe('42501'); // insufficient_privilege
    const code2 = await asRole(client, 'authenticated', USER_A, (q) =>
      errorCode(q, 'select * from clients'),
    );
    expect(code2).toBe('42501');
  });

  it('a client cannot read Notion or Lead Alchemist links or sync state', async () => {
    for (const column of ['notion_page_id', 'ghl_contact_id', 'sync_state', 'sync_error']) {
      const code = await asRole(client, 'authenticated', USER_A, (q) =>
        errorCode(q, `select ${column} from clients`),
      );
      expect(code).toBe('42501');
    }
  });

  it('an archived client sees nothing', async () => {
    const result = await asRole(client, 'authenticated', USER_ARCHIVED, async (q) => ({
      clients: (await q('select id from clients')).rows,
      requests: (await q('select id from document_requests')).rows,
    }));
    expect(result.clients).toHaveLength(0);
    expect(result.requests).toHaveLength(0);
  });

  it('a signed-in user with no client record sees nothing', async () => {
    const rows = await asRole(client, 'authenticated', USER_NO_CLIENT, (q) =>
      q('select id from clients'),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('a client cannot insert, update or delete client records', async () => {
    const codes = await asRole(client, 'authenticated', USER_A, async (q) => [
      await errorCode(
        q,
        `insert into clients (first_name, last_name, email) values ('Evil', 'Mallory', 'mallory@example.test')`,
      ),
      await errorCode(q, `update clients set first_name = 'Changed' where id = $1`, [
        ids.client_Test,
      ]),
      await errorCode(q, `delete from clients where id = $1`, [ids.client_Pat]),
    ]);
    expect(codes).toEqual(['42501', '42501', '42501']);
  });
});

describe('document requests', () => {
  it('a client sees exactly their own requests', async () => {
    const rows = await asRole(client, 'authenticated', USER_A, (q) =>
      q('select id from document_requests order by id'),
    );
    expect(rows.rows.map((r) => r.id).sort()).toEqual([ids.req_A1, ids.req_A2].sort());
  });

  it("a client cannot read another client's request even by id", async () => {
    const rows = await asRole(client, 'authenticated', USER_A, (q) =>
      q('select id from document_requests where id = $1', [ids.req_B1]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('a client cannot change request status or create requests', async () => {
    const codes = await asRole(client, 'authenticated', USER_A, async (q) => [
      await errorCode(q, `update document_requests set status = 'accepted' where id = $1`, [
        ids.req_A1,
      ]),
      await errorCode(
        q,
        `insert into document_requests (client_id, document_type_id) values ($1, $2)`,
        [ids.client_Test, ids.type_W2],
      ),
    ]);
    expect(codes).toEqual(['42501', '42501']);
  });

  it('a client cannot read who requested or reviewed a request', async () => {
    const code = await asRole(client, 'authenticated', USER_A, (q) =>
      errorCode(q, 'select requested_by from document_requests'),
    );
    expect(code).toBe('42501');
  });
});

describe('document types', () => {
  it('a client sees only the document types their own requests reference', async () => {
    const rows = await asRole(client, 'authenticated', USER_A, (q) =>
      q('select id from document_types'),
    );
    expect(rows.rows.map((r) => r.id).sort()).toEqual(
      [ids.type_DriversLicense, ids.type_W2].sort(),
    );
  });

  it('a client cannot read naming templates or target folders', async () => {
    const code = await asRole(client, 'authenticated', USER_A, (q) =>
      errorCode(q, 'select target_subfolder from document_types'),
    );
    expect(code).toBe('42501');
  });
});

describe('uploads', () => {
  it('a client sees only their own uploads and not SharePoint URLs', async () => {
    const result = await asRole(client, 'authenticated', USER_A, async (q) => ({
      rows: (await q('select id, final_filename from uploads')).rows,
      urlCode: await errorCode(q, 'select sharepoint_web_url from uploads'),
      folderCode: await errorCode(q, 'select target_folder_id from uploads'),
    }));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].final_filename).toBe('TClient_W2_2025_2026-11-12.pdf');
    expect(result.urlCode).toBe('42501');
    expect(result.folderCode).toBe('42501');
  });

  it('a client cannot create or modify uploads directly', async () => {
    const codes = await asRole(client, 'authenticated', USER_A, async (q) => [
      await errorCode(
        q,
        `insert into uploads (request_id, client_id, final_filename, target_folder_id, target_folder_path,
                              declared_size_bytes, mime) values ($1, $2, 'x.pdf', 'F', 'P', 1, 'application/pdf')`,
        [ids.req_A1, ids.client_Test],
      ),
      await errorCode(q, `update uploads set status = 'complete'`),
    ]);
    expect(codes).toEqual(['42501', '42501']);
  });
});

describe('admin-only tables', () => {
  for (const table of [
    'admins',
    'audit_log',
    'rate_limits',
    'request_bundles',
    'request_bundle_items',
  ]) {
    it(`a client cannot read ${table}`, async () => {
      const code = await asRole(client, 'authenticated', USER_A, (q) =>
        errorCode(q, `select count(*) from ${table}`),
      );
      expect(code).toBe('42501');
    });
  }

  it('a client cannot call the rate limit function', async () => {
    const code = await asRole(client, 'authenticated', USER_A, (q) =>
      errorCode(q, `select rate_limit_hit('x', 5, 60)`),
    );
    expect(code).toBe('42501');
  });
});

describe('anonymous access', () => {
  for (const table of [
    'clients',
    'document_requests',
    'document_types',
    'uploads',
    'admins',
    'audit_log',
    'rate_limits',
    'request_bundles',
    'request_bundle_items',
  ]) {
    it(`anon cannot read ${table}`, async () => {
      const code = await asRole(client, 'anon', null, (q) =>
        errorCode(q, `select count(*) from ${table}`),
      );
      expect(code).toBe('42501');
    });
  }
});

describe('every public table has RLS enabled', () => {
  it('no table in public is missing row level security', async () => {
    const rows = await client.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.rows).toEqual([]);
  });
});

describe('service role and system invariants', () => {
  it('the audit log is append-only even for the service role', async () => {
    const codes = await asRole(client, 'service_role', null, async (q) => [
      await errorCode(q, `update audit_log set action = 'tampered.event'`),
      await errorCode(q, `delete from audit_log`),
    ]);
    expect(codes[0]).not.toBeNull();
    expect(codes[1]).not.toBeNull();
  });

  it('the rate limiter allows up to the limit and then refuses', async () => {
    const results = await asRole(client, 'service_role', null, async (q) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await q(`select rate_limit_hit('test:key', 3, 600) as ok`);
        out.push(r.rows[0].ok);
      }
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it('the rate limiter resets after the window passes', async () => {
    const result = await asRole(client, 'service_role', null, async (q) => {
      for (let i = 0; i < 3; i++) await q(`select rate_limit_hit('test:reset', 2, 60)`);
      await q(
        `update rate_limits set window_start = now() - interval '2 minutes' where key = 'test:reset'`,
      );
      return (await q(`select rate_limit_hit('test:reset', 2, 60) as ok`)).rows[0].ok;
    });
    expect(result).toBe(true);
  });
});
