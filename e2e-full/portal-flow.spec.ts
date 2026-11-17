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
  freshTotp,
  GRAPH_MOCK,
  makePng,
  mockContent,
  mockFiles,
  setSsoIdentity,
  setUpPasswordAndAuthenticator,
  signInWithCode,
  signInWithPassword,
  startClientSetup,
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
// Todd's office manager, added by Todd on the People page.
const OLIVIA = { first: 'Olivia', last: 'Office', email: `olivia.office.${RUN}@example.com` };
const TODD_PASSWORD = `blue heron porch light ${RUN}`;
const WORK_TENANT = '11111111-2222-4333-8444-555555555555';
const DL = "Driver's License (front and back)";
const BANK = 'Bank Statement';

let admin: Page;
let todd: Page;
let toddContext: BrowserContext;
const ids: { todd?: string; sam?: string; toddDl?: string; toddBank?: string; samDl?: string } = {};
const codes: string[] = [];
let toddSecret = '';
let olivia: Page;
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

test('the client sets up a password and authenticator on a phone and sees exactly their own requests', async () => {
  // First time: an emailed code proves the address, then a password plus an authenticator app.
  codes.push(await startClientSetup(todd, TODD.email));
  toddSecret = await setUpPasswordAndAuthenticator(todd, TODD_PASSWORD);
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

test('Take photo uses the in-browser camera with review before sending', async () => {
  await todd.goto(`/request/${ids.toddBank}`);
  await todd.getByRole('button', { name: 'Send another file for this item' }).click();
  await todd.getByRole('button', { name: /Take photo/ }).click();
  const camera = todd.getByRole('dialog', { name: 'Take photo' });
  await camera.getByRole('button', { name: 'Take picture' }).click({ timeout: 20_000 });
  // Review screen: the picture can be retaken before it is used.
  await camera.getByRole('button', { name: 'Retake' }).click();
  await camera.getByRole('button', { name: 'Take picture' }).click({ timeout: 20_000 });
  await camera.getByRole('button', { name: 'Use photo' }).click();
  await expect(camera).toBeHidden();
  await expect(todd.getByText(/^Photo/)).toBeVisible();
  await todd.getByRole('button', { name: 'Send to Quail Hollow' }).click();
  await expect(todd.getByText(`Thank you! We received your ${BANK}.`)).toBeVisible({
    timeout: 60_000,
  });

  const prefix = `Clients/Test, Todd/Individual/Income Documents/2025/TTest_BankStatement_2025_${firmDate()} 2.`;
  const shot = (await mockFiles()).find((f) => f.path.startsWith(prefix));
  expect(shot, 'camera photo filed next to the earlier scans').toBeTruthy();
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
  await expect(admin.getByRole('link', { name: 'Test, Todd', exact: true })).toBeVisible();

  const saved = await adminRest<{ key: string; value: string }[]>(
    'portal_settings?select=key,value',
  );
  expect(saved.find((r) => r.key === 'sp_root_folder_id')?.value).toBe('E2EROOT');
  const audit = await adminRest<{ action: string }[]>(
    'audit_log?select=action&action=eq.settings.sharepoint_connected',
  );
  expect(audit.length).toBeGreaterThan(0);
});

test('the main contact adds an office manager, who signs in with Google and sees the same requests', async ({
  browser,
}) => {
  await todd.goto('/people');
  await todd.getByLabel('First name').fill(OLIVIA.first);
  await todd.getByLabel('Last name').fill(OLIVIA.last);
  await todd.getByLabel('Their email').fill(OLIVIA.email);
  await todd.getByLabel('Email them an invite now').uncheck();
  await todd.getByRole('button', { name: 'Add person' }).click();
  await expect(todd.getByText(`${OLIVIA.first} can now sign in`)).toBeVisible();
  await expect(todd.locator('li', { hasText: OLIVIA.email })).toBeVisible();

  await setSsoIdentity('google', {
    email: OLIVIA.email.toUpperCase(),
    email_verified: true,
    name: 'Olivia Office',
  });
  olivia = await (await phoneContext(browser)).newPage();
  await olivia.goto('/login');
  await olivia.getByRole('link', { name: 'Continue with Google' }).click();
  await expectSignedInAt(olivia, '/');
  const hrefs = await olivia
    .locator('a[href^="/request/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(new Set(hrefs)).toEqual(new Set([`/request/${ids.toddDl}`, `/request/${ids.toddBank}`]));
  // Only the main contact manages people.
  await expect(olivia.getByRole('link', { name: 'People' })).toHaveCount(0);
  await olivia.goto('/people');
  await olivia.waitForURL((u) => u.pathname === '/');

  const logins = await adminRest<{ metadata: { method?: string } }[]>(
    `audit_log?select=metadata&action=eq.client.login&target_id=eq.${ids.todd}`,
  );
  expect(new Set(logins.map((r) => r.metadata.method))).toEqual(new Set(['password', 'google']));
});

test('Google or Microsoft sign-in is refused for an email that is not approved or not verified', async ({
  browser,
}) => {
  const page = await (await phoneContext(browser)).newPage();
  await setSsoIdentity('microsoft', {
    email: `stranger.${RUN}@example.com`,
    tid: WORK_TENANT,
    xms_edov: true,
  });
  await page.goto('/login');
  await page.getByRole('link', { name: 'Continue with Microsoft' }).click();
  await page.waitForURL(/\/login\?sso=no_match/);
  await expect(page.getByText('is not on our list of people who can sign in')).toBeVisible();

  // A work account whose email domain Microsoft has not verified, even for an approved email.
  await setSsoIdentity('microsoft', { email: SAM.email, tid: WORK_TENANT, xms_edov: false });
  await page.getByRole('link', { name: 'Continue with Microsoft' }).click();
  await page.waitForURL(/\/login\?sso=unverified/);
  await setSsoIdentity('google', { email: SAM.email, email_verified: false });
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/login\?sso=unverified/);
  await page.goto('/');
  await page.waitForURL((u) => u.pathname === '/login');
});

test('Sam sets up a passkey with an emailed code, then signs in with the passkey alone', async ({
  browser,
}) => {
  const context = await phoneContext(browser);
  const page = await context.newPage();
  // A built-in passkey authenticator that approves every prompt (Face ID / fingerprint).
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  codes.push(await startClientSetup(page, SAM.email));
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expectSignedInAt(page, '/');
  await expect(page.locator(`a[href="/request/${ids.samDl}"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((u) => u.pathname === '/login');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expectSignedInAt(page, '/');
  await expect(page.locator(`a[href="/request/${ids.samDl}"]`)).toBeVisible();
});

test('a password alone or an emailed code alone never reaches documents; recovery needs the authenticator', async ({
  browser,
}) => {
  // Password + authenticator: full sign-in.
  const page = await (await phoneContext(browser)).newPage();
  await signInWithPassword(page, TODD.email, TODD_PASSWORD, toddSecret);
  await expectSignedInAt(page, '/');

  // A wrong password is refused without saying whether the email exists.
  const wrong = await (await phoneContext(browser)).newPage();
  await wrong.goto('/login');
  await wrong.getByLabel('Email address').fill(TODD.email);
  await wrong.getByLabel('Password').fill('not the right password');
  await wrong.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(wrong.getByText('do not match')).toBeVisible();

  // An emailed code alone: only the setup screen, which asks for the authenticator first.
  const context = await phoneContext(browser);
  const setup = await context.newPage();
  codes.push(await startClientSetup(setup, TODD.email));
  await expect(setup.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
  await setup.goto('/');
  await setup.waitForURL((u) => u.pathname === '/account/setup');
  const start = await setup.request.post('/api/uploads/start', {
    headers: { origin: new URL(setup.url()).origin },
    data: {
      requestId: ids.toddBank,
      mime: 'application/pdf',
      size: 1000,
      pageCount: 1,
      captureMethod: 'file',
      originalName: 'x.pdf',
    },
  });
  expect(start.status()).toBe(403);
  // Its database token reads nothing, even straight from the database API.
  const token = accessTokenFromCookies(await context.cookies());
  expect((await clientRest(token, 'clients?select=id')).body).toEqual([]);
  expect((await clientRest(token, 'document_requests?select=id')).body).toEqual([]);
  expect((await clientRest(token, 'client_users?select=id')).body).toEqual([]);

  // Recovery: the authenticator code, then a new password.
  await setup.getByLabel('Authenticator code').fill(await freshTotp(toddSecret));
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByLabel('New password').fill(`${TODD_PASSWORD} again`);
  await setup.getByLabel('Type it again').fill(`${TODD_PASSWORD} again`);
  await setup.getByRole('button', { name: 'Save password' }).click();
  await expectSignedInAt(setup, '/');
});

test('Aleida removes the office manager, who is signed out and cannot sign in again', async () => {
  await admin.goto(`/admin/clients/${ids.todd}`);
  const row = admin.locator('li', { hasText: OLIVIA.email });
  await expect(row.getByText('Active')).toBeVisible();
  admin.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(admin.getByText('Removed. They can no longer sign in.')).toBeVisible();
  await expect(admin.locator('li', { hasText: OLIVIA.email })).toHaveCount(0);

  await olivia.goto('/');
  await olivia.waitForURL((u) => u.pathname === '/login');
  await setSsoIdentity('google', { email: OLIVIA.email, email_verified: true });
  await olivia.getByRole('link', { name: 'Continue with Google' }).click();
  await olivia.waitForURL(/\/login\?sso=no_match/);
});

test('no file bytes, sign-in codes or upload links are stored', async () => {
  const tables = ['audit_log', 'uploads', 'document_requests', 'clients', 'client_users'];
  const dump = JSON.stringify(
    await Promise.all(tables.map((t) => adminRest<unknown[]>(`${t}?select=*&limit=1000`))),
  );
  expect(dump).not.toContain(`${GRAPH_MOCK}/upload/`);
  // A stored code would be a string value ("123456"); bare digits also occur in timestamps.
  for (const code of codes) expect(dump).not.toContain(`"${code}"`);
  // Nor the authenticator key or a password.
  expect(dump).not.toContain(toddSecret);
  expect(dump).not.toContain(TODD_PASSWORD);
  const uploads = await adminRest<
    { size_bytes: number; sharepoint_item_id: string; status: string }[]
  >(`uploads?select=size_bytes,sharepoint_item_id,status&client_id=eq.${ids.todd}`);
  expect(uploads.filter((u) => u.status === 'complete')).toHaveLength(3);
  expect(
    uploads.every((u) => u.status !== 'complete' || (u.sharepoint_item_id && u.size_bytes > 0)),
  ).toBe(true);
});
