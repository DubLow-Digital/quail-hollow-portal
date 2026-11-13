/**
 * Step 5 of docs/entra-setup.md: grant the "Quail Hollow Client Portal" app `write` on
 * exactly one SharePoint site (Sites.Selected).
 *
 * This call must be made by an identity holding Sites.FullControl.All. Choose one:
 *   --device-code            Sign in interactively as a Global Admin (default).
 *   --app                    Use a temporary admin app: GRANT_ADMIN_CLIENT_ID and
 *                            GRANT_ADMIN_CLIENT_SECRET (application Sites.FullControl.All).
 *
 * Usage:
 *   npm run graph:grant -- --site contoso.sharepoint.com:/sites/Clients [--dry-run]
 *   npm run graph:grant -- --site <site-id> --app
 *
 * Reads MS_TENANT_ID and MS_PORTAL_CLIENT_ID from the environment (.env.local).
 * Remove the temporary admin access afterwards (see the runbook).
 */
import {
  arg,
  clientCredentialsToken,
  deviceCodeToken,
  flag,
  graph,
  requireEnv,
  resolveSiteId,
} from './lib/graph-script';

interface Permission {
  id: string;
  roles?: string[];
  grantedToIdentitiesV2?: { application?: { id?: string; displayName?: string } }[];
  grantedToIdentities?: { application?: { id?: string; displayName?: string } }[];
}

async function main() {
  const tenantId = requireEnv('MS_TENANT_ID');
  const portalClientId = requireEnv('MS_PORTAL_CLIENT_ID');
  const siteRef = arg('site') || process.env.SP_SITE_ID;
  if (!siteRef) {
    console.error('Pass --site contoso.sharepoint.com:/sites/SitePath (or set SP_SITE_ID).');
    process.exit(2);
  }
  const dryRun = flag('dry-run');

  const token = flag('app')
    ? await clientCredentialsToken(
        tenantId,
        requireEnv('GRANT_ADMIN_CLIENT_ID'),
        requireEnv('GRANT_ADMIN_CLIENT_SECRET'),
      )
    : await deviceCodeToken(tenantId);

  const siteId = await resolveSiteId(token, siteRef);
  console.log(`SP_SITE_ID=${siteId}`);

  const drives = await graph<{ value: { id: string; name: string; webUrl: string }[] }>(
    token,
    `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl`,
  );
  if (drives.ok && drives.data) {
    console.log(
      '\nDocument libraries on this site (pick the one holding client folders for SP_DRIVE_ID):',
    );
    for (const d of drives.data.value) console.log(`  ${d.name}: ${d.id}`);
  }

  const existing = await graph<{ value: Permission[] }>(
    token,
    `/sites/${encodeURIComponent(siteId)}/permissions`,
  );
  if (!existing.ok) {
    console.error(`Could not read site permissions (${existing.status} ${existing.errorCode}).`);
    console.error('The signed-in identity needs Sites.FullControl.All.');
    process.exit(1);
  }
  const current = existing.data?.value.find((p) =>
    [...(p.grantedToIdentitiesV2 ?? []), ...(p.grantedToIdentities ?? [])].some(
      (g) => g.application?.id === portalClientId,
    ),
  );

  if (current) {
    const roles = current.roles ?? [];
    console.log(`\nThe portal app already has: ${roles.join(', ') || '(no roles)'}`);
    if (roles.length === 1 && roles[0] === 'write') {
      console.log('Nothing to change.');
      return;
    }
    if (dryRun) {
      console.log('Dry run: would set roles to ["write"].');
      return;
    }
    const patched = await graph(
      token,
      `/sites/${encodeURIComponent(siteId)}/permissions/${current.id}`,
      {
        method: 'PATCH',
        body: { roles: ['write'] },
      },
    );
    console.log(
      patched.ok
        ? 'Updated roles to ["write"].'
        : `Update failed (${patched.status} ${patched.errorCode}).`,
    );
    if (!patched.ok) process.exitCode = 1;
    return;
  }

  const body = {
    roles: ['write'],
    grantedToIdentities: [
      { application: { id: portalClientId, displayName: 'Quail Hollow Client Portal' } },
    ],
  };
  if (dryRun) {
    console.log('\nDry run: would POST this permission:');
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const created = await graph<Permission>(
    token,
    `/sites/${encodeURIComponent(siteId)}/permissions`,
    {
      method: 'POST',
      body,
    },
  );
  if (!created.ok) {
    console.error(`Grant failed (${created.status} ${created.errorCode}).`);
    process.exit(1);
  }
  console.log(
    `\nGranted "write" on this site to the portal app (permission id ${created.data?.id}).`,
  );
  console.log(
    'Next: remove the temporary Sites.FullControl.All access, then run `npm run graph:check`.',
  );
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
