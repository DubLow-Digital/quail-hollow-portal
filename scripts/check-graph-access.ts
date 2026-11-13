/**
 * Step 7 of docs/entra-setup.md: verify the portal app's SharePoint access using only the
 * portal app's own credentials.
 *
 * Checks:
 *   1. The token carries Sites.Selected and no broad SharePoint/Files permission.
 *   2. The granted site is readable.
 *   3. Other sites are NOT reachable (tenant root, site search, and --other-site if given).
 *   4. The client root folder lists, and a test folder "_portal-access-test" can be
 *      created and deleted.
 *
 * Usage:
 *   npm run graph:check
 *   npm run graph:check -- --other-site contoso.sharepoint.com:/sites/SomeOtherSite
 *
 * Exit code is non-zero if any check fails.
 */
import {
  arg,
  clientCredentialsToken,
  fail,
  graph,
  pass,
  requireEnv,
  tokenRoles,
} from './lib/graph-script';

const BROAD_ROLES = [
  'Sites.Read.All',
  'Sites.ReadWrite.All',
  'Sites.Manage.All',
  'Sites.FullControl.All',
  'Files.Read.All',
  'Files.ReadWrite.All',
];

async function main() {
  const tenantId = requireEnv('MS_TENANT_ID');
  const siteId = requireEnv('SP_SITE_ID');
  const driveId = requireEnv('SP_DRIVE_ID');
  const rootFolderId = requireEnv('SP_CLIENT_ROOT_FOLDER_ID');
  const token = await clientCredentialsToken(
    tenantId,
    requireEnv('MS_PORTAL_CLIENT_ID'),
    requireEnv('MS_PORTAL_CLIENT_SECRET'),
  );

  console.log('\n1. App permissions');
  const roles = tokenRoles(token);
  console.log(`   Token roles: ${roles.join(', ') || '(none)'}`);
  if (roles.includes('Sites.Selected')) pass('Sites.Selected is granted');
  else fail('Sites.Selected is missing (add it and grant admin consent)');
  const broad = roles.filter((r) => BROAD_ROLES.includes(r));
  if (broad.length === 0) pass('No tenant-wide SharePoint or Files permissions');
  else fail(`Remove these broad permissions: ${broad.join(', ')}`);

  console.log('\n2. Granted site');
  const site = await graph<{ displayName: string }>(
    token,
    `/sites/${encodeURIComponent(siteId)}?$select=displayName`,
  );
  if (site.ok) pass(`Can read the granted site (${site.data?.displayName})`);
  else fail(`Cannot read the granted site (${site.status} ${site.errorCode}); run graph:grant`);

  console.log('\n3. Other sites must be unreachable');
  const root = await graph(token, '/sites/root');
  if (!root.ok) pass(`Tenant root site refused (${root.status})`);
  else fail('Tenant root site is readable; the app has more access than one site');

  const search = await graph<{ value: { id: string }[] }>(token, '/sites?search=*');
  const others = search.ok ? (search.data?.value ?? []).filter((s) => s.id !== siteId) : [];
  if (!search.ok || others.length === 0)
    pass(`Site search returns no other sites (${search.status})`);
  else fail(`Site search returned ${others.length} other site(s)`);

  const otherSite = arg('other-site');
  if (otherSite) {
    const match = /^([a-z0-9.-]+\.sharepoint\.com):?(\/sites\/[^?#]+)$/i.exec(otherSite);
    const res = match
      ? await graph(token, `/sites/${match[1]}:${match[2]}`)
      : await graph(token, `/sites/${encodeURIComponent(otherSite)}`);
    if (!res.ok) pass(`--other-site refused (${res.status})`);
    else fail('--other-site is readable; the grant is too broad');
  }

  console.log('\n4. Client folders');
  const children = await graph<{ value: { name: string; folder?: object }[] }>(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootFolderId)}/children?$select=name,folder&$top=200`,
  );
  if (children.ok) {
    const folders = (children.data?.value ?? []).filter((c) => c.folder);
    pass(`Listed the client root folder: ${folders.length} folder(s)`);
    for (const f of folders.slice(0, 50)) console.log(`        ${f.name}`);
    if (folders.length > 50) console.log(`        ... and ${folders.length - 50} more`);
  } else {
    fail(`Cannot list the client root folder (${children.status} ${children.errorCode})`);
  }

  const created = await graph<{ id: string }>(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootFolderId)}/children`,
    {
      method: 'POST',
      body: {
        name: '_portal-access-test',
        folder: {},
        '@microsoft.graph.conflictBehavior': 'replace',
      },
    },
  );
  if (created.ok && created.data) {
    pass('Created _portal-access-test');
    const removed = await graph(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${created.data.id}`,
      {
        method: 'DELETE',
      },
    );
    if (removed.ok) pass('Deleted _portal-access-test');
    else fail(`Could not delete _portal-access-test (${removed.status}); remove it by hand`);
  } else {
    fail(
      `Could not create a test folder (${created.status} ${created.errorCode}); the grant may be read-only`,
    );
  }

  console.log(process.exitCode ? '\nSome checks failed.' : '\nAll checks passed.');
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
