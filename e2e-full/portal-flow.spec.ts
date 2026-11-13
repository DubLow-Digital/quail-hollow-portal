import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import {
  accessTokenFromCookies,
  adminRest,
  clientRest,
  expectSignedInAt,
  firmDate,
  GRAPH_MOCK,
  makePng,
  mockContent,
  mockFiles,
  signInWithCode,
} from './helpers';

/**
 * The whole Phase 1 journey against real Supabase Auth, PostgREST and Postgres (local
 * `supabase start`) and the Graph stand-in, on a phone-sized screen. Fake people only.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const TODD = { first: 'Todd', last: 'Test', email: `todd.test.${RUN}@example.com` };
const SAM = { first: 'Sam', last: 'Sample', email: `sam.sample.${RUN}@example.com` };
const DL = "Driver's License (front and back)";
const BANK = 'Bank Statement';

let admin: Page;
let todd: Page;
let toddContext: BrowserContext;
const ids: { todd?: string; sam?: string; toddDl?: string; toddBank?: string; samDl?: string } = {};
const codes: string[] = [];
const files = { photo: '', big: '' };

async function phoneContext(browser: Browser) {
  return browser.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
}

test.beforeAll(async ({ browser }, info) => {
  const dir = info.outputPath('fixtures');
  mkdirSync(dir, { recursive: true });
  files.photo = join(dir, 'license-photo.png');
  writeFileSync(files.photo, makePng());
  // 40 MB "bank statement" PDF, as in the acceptance criteria.
  files.big = join(dir, 'statement-40mb.pdf');
  const pad = Buffer.alloc(40 * 1024 * 1024, 0x20);
  writeFileSync(
    files.big,
    Buffer.concat([Buffer.from('%PDF-1.7\n%âã\n'), pad, Buffer.from('\n%%EOF\n')]),
  );
  admin = await (await phoneContext(browser)).newPage();
  toddContext = await phoneContext(browser);
  todd = await toddContext.newPage();
});

async function addClient(person: typeof TODD): Promise<string> {
  await admin.goto('/admin/clients/new');
  await admin.getByLabel('First name', { exact: true }).fill(person.first);
  await admin.getByLabel('Last name', { exact: true }).fill(person.last);
  await admin.getByLabel('Email', { exact: true }).fill(person.email);
  await admin.getByRole('button', { name: 'Add client' }).click();
  await admin.waitForURL(/\/admin\/clients\/[0-9a-f-]{36}\?created=1/);
  const id = /clients\/([0-9a-f-]{36})/.exec(admin.url())![1]!;
  await admin.getByRole('button', { name: 'Create folder' }).click();
  // The page refreshes into its "linked" state once the folder exists.
  await expect(admin.locator('p', { hasText: 'Linked to' })).toContainText(
    `${person.last}, ${person.first}`,
  );
  return id;
}

async function requestDocs(clientId: string, names: string[]) {
  for (const name of names) await admin.getByLabel(name, { exact: true }).check();
  await admin.getByLabel('Email the client that documents are requested').uncheck();
  await admin
    .getByRole('button', { name: new RegExp(`^Request ${names.length} document`) })
    .click();
  await expect.poll(async () => (await requestIds(clientId)).length).toBe(names.length);
}

async function requestIds(clientId: string) {
  return adminRest<{ id: string; document_types: { slug_for_filename: string } }[]>(
    `document_requests?select=id,document_types(slug_for_filename)&client_id=eq.${clientId}`,
  );
}

test('Aleida signs in with an emailed code and sets up two clients', async () => {
  codes.push(await signInWithCode(admin, '/admin/signin', ADMIN));
  await expectSignedInAt(admin, '/admin');

  ids.todd = await addClient(TODD);
  await requestDocs(ids.todd, [DL, BANK]);
  ids.sam = await addClient(SAM);
  await requestDocs(ids.sam, [DL]);

  const toddReqs = await requestIds(ids.todd);
  ids.toddDl = toddReqs.find((r) => r.document_types.slug_for_filename === 'DriversLicense')!.id;
  ids.toddBank = toddReqs.find((r) => r.document_types.slug_for_filename === 'BankStatement')!.id;
  ids.samDl = (await requestIds(ids.sam))[0]!.id;
  expect(toddReqs).toHaveLength(2);
});

test('the client signs in on a phone and sees exactly their own requests', async () => {
  codes.push(await signInWithCode(todd, '/login', TODD.email));
  await expectSignedInAt(todd, '/');
  await expect(todd.getByRole('heading', { name: 'Still needed' })).toBeVisible();
  const hrefs = await todd
    .locator('a[href^="/request/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(new Set(hrefs)).toEqual(new Set([`/request/${ids.toddDl}`, `/request/${ids.toddBank}`]));
});

test('a photo of a fake license lands in the ID folder with the firm name', async () => {
  await todd.goto(`/request/${ids.toddDl}`);
  await todd.locator('input[type=file][capture]').setInputFiles(files.photo);
  await todd.getByRole('button', { name: 'Send to Quail Hollow' }).click();
  await expect(todd.getByText(`Thank you! We received your ${DL}.`)).toBeVisible({
    timeout: 60_000,
  });

  const all = await mockFiles();
  const photo = all.find(
    (f) => f.path === `Clients/Test, Todd/Individual/ID/TTest_DriversLicense_${firmDate()}.jpg`,
  );
  expect(photo, JSON.stringify(all.map((f) => f.path))).toBeTruthy();
  const bytes = await mockContent(photo!.id);
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // re-encoded as JPEG in the browser
});

test('a three-page scan arrives as one PDF', async () => {
  await todd.goto(`/request/${ids.toddBank}`);
  await todd.getByRole('button', { name: /Scan document/ }).click();
  const scanner = todd.getByRole('dialog', { name: 'Scan document' });
  for (let page = 1; page <= 3; page++) {
    await scanner.getByRole('button', { name: `Capture page ${page}` }).click({ timeout: 20_000 });
    await expect(
      scanner.getByText(`${page} page${page === 1 ? '' : 's'}`, { exact: true }),
    ).toBeVisible();
  }
  await scanner.getByRole('button', { name: 'Done' }).click();
  await expect(todd.getByText('3-page scan')).toBeVisible();
  await todd.getByRole('button', { name: 'Send to Quail Hollow' }).click();
  await expect(todd.getByText(`Thank you! We received your ${BANK}.`)).toBeVisible({
    timeout: 60_000,
  });

  const scan = (await mockFiles()).find(
    (f) =>
      f.path ===
      `Clients/Test, Todd/Individual/Income Documents/2025/TTest_BankStatement_2025_${firmDate()}.pdf`,
  );
  expect(scan).toBeTruthy();
  const pdf = await PDFDocument.load(await mockContent(scan!.id));
  expect(pdf.getPageCount()).toBe(3);
});

test('a 40 MB PDF uploads in chunks and keeps the earlier file', async () => {
  await todd.getByRole('button', { name: 'Send another file for this item' }).click();
  await todd.locator('input[type=file]:not([capture])').setInputFiles(files.big);
  await todd.getByRole('button', { name: 'Send to Quail Hollow' }).click();
  await expect(todd.getByText(`Thank you! We received your ${BANK}.`)).toBeVisible({
    timeout: 180_000,
  });

  const big = (await mockFiles()).find(
    (f) =>
      f.path ===
      `Clients/Test, Todd/Individual/Income Documents/2025/TTest_BankStatement_2025_${firmDate()} 1.pdf`,
  );
  expect(big?.size).toBe(40 * 1024 * 1024 + 22);
});

test("a client cannot see or upload to another client's request", async () => {
  // The page: not found, not "forbidden", so it does not even confirm the request exists.
  await todd.goto(`/request/${ids.samDl}`);
  await expect(todd.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();

  // The upload API, with Todd's session.
  const start = await todd.request.post('/api/uploads/start', {
    headers: { origin: new URL(todd.url()).origin },
    data: {
      requestId: ids.samDl,
      mime: 'application/pdf',
      size: 1000,
      pageCount: 1,
      captureMethod: 'file',
      originalName: 'x.pdf',
    },
  });
  expect([403, 404]).toContain(start.status());

  // Straight to the database API with Todd's own token: row level security.
  const token = accessTokenFromCookies(await toddContext.cookies());
  const reqs = await clientRest(token, 'document_requests?select=id');
  expect(reqs.status).toBe(200);
  expect(new Set((reqs.body as { id: string }[]).map((r) => r.id))).toEqual(
    new Set([ids.toddDl, ids.toddBank]),
  );
  const clients = await clientRest(token, 'clients?select=id');
  expect((clients.body as { id: string }[]).map((c) => c.id)).toEqual([ids.todd]);
  expect((await clientRest(token, `document_requests?select=id&id=eq.${ids.samDl}`)).body).toEqual(
    [],
  );
  expect((await clientRest(token, `uploads?select=id&client_id=eq.${ids.sam}`)).body).toEqual([]);
  // Admin-only columns stay hidden even for the client's own record.
  expect((await clientRest(token, 'clients?select=sharepoint_folder_id')).status).not.toBe(200);
  expect((await clientRest(token, 'audit_log?select=id')).status).not.toBe(200);
});

test('Aleida accepts the license, browses the files and sees the audit trail', async () => {
  await admin.goto(`/admin/clients/${ids.todd}`);
  await expect(admin.getByText(`TTest_DriversLicense_${firmDate()}.jpg`)).toBeVisible();
  const dlItem = admin.locator('li', { hasText: DL }).first();
  await dlItem.getByRole('button', { name: 'Accept' }).click();
  await expect(dlItem.getByText('Accepted', { exact: true })).toBeVisible();

  // The client's list moves it to Received.
  await todd.goto('/');
  await expect(todd.locator('section', { hasText: 'Received' }).getByText(DL)).toBeVisible();

  // File browser: the client's folder, a portal badge, and an audited download link.
  await admin.goto(`/admin/clients/${ids.todd}`);
  await admin.getByRole('link', { name: 'Browse files' }).click();
  await expect(admin.getByRole('navigation', { name: 'Folder path' })).toContainText('Test, Todd');
  await admin.getByRole('link', { name: 'Individual', exact: true }).click();
  await admin.getByRole('link', { name: 'ID', exact: true }).click();
  const row = admin.locator('li', { hasText: `TTest_DriversLicense_${firmDate()}.jpg` });
  await expect(row.getByText('From portal')).toBeVisible();
  const href = await row.getByRole('link', { name: 'Download' }).getAttribute('href');
  const download = await admin.request.get(href!, { maxRedirects: 0 });
  expect(download.status()).toBe(302);
  expect(download.headers().location?.startsWith(`${GRAPH_MOCK}/content/`)).toBe(true);

  // Audit trail covers sign-ins, uploads and admin actions.
  type Row = { action: string; metadata: unknown; target_id: string | null };
  const audit = await adminRest<Row[]>(
    'audit_log?select=action,metadata,target_id&order=id.desc&limit=500',
  );
  const actions = new Set(audit.map((r) => r.action));
  for (const a of [
    'admin.login',
    'client.created',
    'client.folder_created',
    'request.created',
    'client.otp_requested',
    'client.login',
    'upload.started',
    'upload.completed',
    'request.accepted',
    'file.downloaded',
  ]) {
    expect(actions, a).toContain(a);
  }
  await admin.goto('/admin/audit');
  await expect(admin.getByText('upload.completed').first()).toBeVisible();
});

test('Connect SharePoint shows what the portal app can reach and saves the folder', async () => {
  await admin.goto('/admin/sharepoint');
  // Scope to the page content: the admin menu also has a "Clients" link.
  const main = admin.getByRole('main');
  await expect(main.getByText('Working')).toBeVisible();
  await main.getByRole('link', { name: /Quail Hollow Clients/ }).click();
  await expect(main.getByRole('heading', { name: '2. Choose the document library' })).toBeVisible();
  await main.getByRole('link', { name: /Documents/ }).click();
  await expect(
    main.getByRole('heading', { name: '3. Choose the client folders folder' }),
  ).toBeVisible();
  await main.getByRole('link', { name: /^Clients/ }).click();
  await admin.waitForURL(/folder=E2EROOT/);
  await expect(main.getByRole('link', { name: /^Test, Todd/ })).toBeVisible();
  admin.once('dialog', (d) => void d.accept());
  await admin.getByRole('button', { name: 'Use this folder for client folders' }).click();
  await admin.waitForURL(/\/admin\/files\?connected=1/);
  await expect(admin.getByText('SharePoint connected')).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Test, Todd' })).toBeVisible();

  const saved = await adminRest<{ key: string; value: string }[]>(
    'portal_settings?select=key,value',
  );
  expect(saved.find((r) => r.key === 'sp_root_folder_id')?.value).toBe('E2EROOT');
  const audit = await adminRest<{ action: string }[]>(
    'audit_log?select=action&action=eq.settings.sharepoint_connected',
  );
  expect(audit.length).toBeGreaterThan(0);
});

test('no file bytes, sign-in codes or upload links are stored', async () => {
  const tables = ['audit_log', 'uploads', 'document_requests', 'clients'];
  const dump = JSON.stringify(
    await Promise.all(tables.map((t) => adminRest<unknown[]>(`${t}?select=*&limit=1000`))),
  );
  expect(dump).not.toContain(`${GRAPH_MOCK}/upload/`);
  // A stored code would be a string value ("123456"); bare digits also occur in timestamps.
  for (const code of codes) expect(dump).not.toContain(`"${code}"`);
  const uploads = await adminRest<
    { size_bytes: number; sharepoint_item_id: string; status: string }[]
  >(`uploads?select=size_bytes,sharepoint_item_id,status&client_id=eq.${ids.todd}`);
  expect(uploads.filter((u) => u.status === 'complete')).toHaveLength(3);
  expect(
    uploads.every((u) => u.status !== 'complete' || (u.sharepoint_item_id && u.size_bytes > 0)),
  ).toBe(true);
});
