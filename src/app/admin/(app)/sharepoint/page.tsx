import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import {
  LinkError,
  browseFolder,
  checkAppSignIn,
  getSite,
  grantInstructions,
  listLibraries,
  reachableSites,
  resolveLink,
  type FolderSummary,
  type LibrarySummary,
  type SiteSummary,
} from '@/lib/graph/discover';
import { sharePointLocationStatus } from '@/lib/graph/location';
import { Alert, Badge, Card, EmptyState, Input, PageHeader, buttonClass } from '@/components/ui';
import { ActionButtonForm } from '@/components/action-forms';
import { connectSharePointAction } from './actions';
import { DRIVE_ID, ITEM_ID, SITE_ID } from './ids';

export const metadata = { title: 'Connect SharePoint' };

type Params = { site?: string; drive?: string; folder?: string; link?: string };

const href = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  return `/admin/sharepoint${q.size ? `?${q}` : ''}`;
};

function GrantHelp({ siteId }: { siteId: string | null }) {
  const g = grantInstructions(siteId);
  return (
    <div className="space-y-2 text-sm">
      <p>
        The portal reads and writes SharePoint only through its own app (“Quail Hollow Client
        Portal”), never through anyone’s Microsoft account. A Quail Hollow Global Admin gives that
        app access to the one site that holds client folders, once, in{' '}
        <a
          href="https://developer.microsoft.com/graph/graph-explorer"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-700 underline"
        >
          Graph Explorer
        </a>{' '}
        (signed in as the admin, with Sites.FullControl.All consented):
      </p>
      {!siteId ? (
        <p>
          1. Find the site ID: <code className="rounded bg-neutral-100 px-1">GET</code>{' '}
          <code className="break-all rounded bg-neutral-100 px-1">
            https://graph.microsoft.com/v1.0/sites/YOURTENANT.sharepoint.com:/sites/SITENAME
          </code>{' '}
          and copy its <code>id</code>.
        </p>
      ) : null}
      <p>
        {siteId ? '' : '2. '}Grant the app write access to that site:{' '}
        <code className="rounded bg-neutral-100 px-1">{g.method}</code>{' '}
        <code className="break-all rounded bg-neutral-100 px-1">{g.url}</code>
      </p>
      <pre className="overflow-x-auto rounded-xl bg-neutral-900 p-3 text-xs text-white">
        {g.body}
      </pre>
      <p>Then come back here and refresh. Full steps: docs/entra-setup.md, step 5.</p>
    </div>
  );
}

function FolderList({
  items,
  link,
}: {
  items: { id: string; name: string; sub?: string | null }[];
  link: (id: string) => string;
}) {
  return (
    <ul className="divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-200">
      {items.map((i) => (
        <li key={i.id}>
          <Link
            href={link(i.id)}
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-brand-900">{i.name}</span>
              {i.sub ? (
                <span className="block truncate text-xs text-neutral-500">{i.sub}</span>
              ) : null}
            </span>
            <span aria-hidden="true" className="text-neutral-400">
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ConnectSharePointPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const siteId = params.site && SITE_ID.test(params.site) ? params.site : null;
  const driveId = params.drive && DRIVE_ID.test(params.drive) ? params.drive : null;
  const folderId = params.folder && ITEM_ID.test(params.folder) ? params.folder : null;
  const link = (params.link ?? '').trim().slice(0, 1000);

  const [app, status] = await Promise.all([checkAppSignIn(), sharePointLocationStatus()]);

  let error: { message: string; noAccess: boolean; siteId: string | null } | null = null;
  let sites: SiteSummary[] = [];
  let site: SiteSummary | null = null;
  let libraries: LibrarySummary[] = [];
  let library: LibrarySummary | null = null;
  let folder: FolderSummary | null = null;
  let children: FolderSummary[] = [];

  if (app.ok) {
    try {
      if (link && !siteId) {
        const r = await resolveLink(link);
        site = r.site;
        library = r.library;
        folder = r.folder;
        children = (await browseFolder(r.library.id, r.folder.id)).children;
      } else if (siteId) {
        site = await getSite(siteId);
        libraries = await listLibraries(siteId);
        if (driveId) {
          library = libraries.find((l) => l.id === driveId) ?? null;
          if (library) {
            const b = await browseFolder(driveId, folderId);
            folder = b.folder;
            children = b.children;
          }
        }
      } else {
        sites = await reachableSites();
      }
    } catch (err) {
      error = {
        message:
          err instanceof LinkError
            ? err.message
            : 'SharePoint did not respond. Please try again in a moment.',
        noAccess: err instanceof LinkError && err.reason === 'no_access',
        siteId,
      };
    }
  }

  // Graph names a library's top-level folder "root".
  const isLibraryTop = Boolean(
    folder && library && (link && !siteId ? folder.name === 'root' : !folderId),
  );

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Connect SharePoint"
        description="Choose the SharePoint folder that holds one folder per client. The portal reads and writes it with its own app, not with anyone's Microsoft account."
      />

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-brand-900">Status</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-40 text-neutral-600">Portal app sign-in</span>
            {app.ok ? (
              <Badge tone="green">Working</Badge>
            ) : app.reason === 'not_configured' ? (
              <Badge tone="red">App settings missing</Badge>
            ) : app.reason === 'unavailable' ? (
              <Badge tone="amber">Microsoft not responding</Badge>
            ) : (
              <Badge tone="red">Sign-in refused{app.detail ? ` (${app.detail})` : ''}</Badge>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="w-40 text-neutral-600">Client folders</span>
            {status.location ? (
              <>
                <Badge tone="green">Connected</Badge>
                <span>
                  {[status.location.siteName, status.location.folderPath]
                    .filter(Boolean)
                    .join(' › ') || 'Set in Vercel'}
                </span>
                {status.location.webUrl ? (
                  <a
                    href={status.location.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-700 hover:underline"
                  >
                    Open ↗
                  </a>
                ) : null}
              </>
            ) : (
              <Badge tone="amber">Not chosen yet</Badge>
            )}
          </li>
        </ul>
        {status.source === 'vercel' ? (
          <p className="text-xs text-neutral-500">
            The location is set in Vercel and takes precedence over a folder chosen here.
          </p>
        ) : null}
        {!app.ok && app.reason === 'not_configured' ? (
          <Alert tone="error">
            The portal app’s settings (MS_TENANT_ID, MS_PORTAL_CLIENT_ID, MS_PORTAL_CLIENT_SECRET)
            are missing in Vercel.
          </Alert>
        ) : null}
        {!app.ok && app.reason === 'sign_in_failed' ? (
          <Alert tone="error">
            Microsoft refused the portal app’s sign-in. Check that the tenant ID, app ID and client
            secret in Vercel match the “Quail Hollow Client Portal” app, and that the secret has not
            expired.
          </Alert>
        ) : null}
        {!app.ok && app.reason === 'unavailable' ? (
          <Alert tone="warning">
            Microsoft is not responding right now. Try again in a few minutes.
          </Alert>
        ) : null}
      </Card>

      {app.ok ? (
        <Card className="space-y-4">
          {error ? (
            <Alert
              tone={error.noAccess ? 'warning' : 'error'}
              title={error.noAccess ? 'No access yet' : undefined}
            >
              {error.message}
            </Alert>
          ) : null}
          {error?.noAccess ? <GrantHelp siteId={error.siteId} /> : null}

          {/* Step 1: site */}
          {!site && !error ? (
            <>
              <h2 className="text-lg font-semibold text-brand-900">1. Choose the site</h2>
              {sites.length ? (
                <FolderList
                  items={sites.map((s) => ({ id: s.id, name: s.name, sub: s.webUrl }))}
                  link={(id) => href({ site: id })}
                />
              ) : (
                <>
                  <EmptyState title="The portal app cannot see any SharePoint site yet">
                    It has not been given access to the client site, or Microsoft only lets it open
                    a site by its address. Paste the folder link below to check.
                  </EmptyState>
                  <GrantHelp siteId={null} />
                </>
              )}
            </>
          ) : null}

          {/* Step 2: library */}
          {site && !library && !link ? (
            <>
              <p className="text-sm text-neutral-600">
                Site: <span className="font-medium text-brand-900">{site.name}</span> ·{' '}
                <Link href="/admin/sharepoint" className="text-brand-700 underline">
                  change
                </Link>
              </p>
              <h2 className="text-lg font-semibold text-brand-900">
                2. Choose the document library
              </h2>
              {libraries.length ? (
                <FolderList
                  items={libraries.map((l) => ({ id: l.id, name: l.name, sub: l.webUrl }))}
                  link={(id) => href({ site: site!.id, drive: id })}
                />
              ) : (
                <EmptyState title="No document libraries found on this site" />
              )}
            </>
          ) : null}

          {/* Step 3: folder */}
          {site && library && folder ? (
            <>
              <p className="text-sm text-neutral-600">
                {site.name} › {library.name}
                {isLibraryTop ? '' : ` › … › ${folder.name}`} ·{' '}
                <Link
                  href={href({ site: site.id, drive: library.id })}
                  className="text-brand-700 underline"
                >
                  top of library
                </Link>{' '}
                ·{' '}
                <Link href="/admin/sharepoint" className="text-brand-700 underline">
                  start over
                </Link>
              </p>
              <h2 className="text-lg font-semibold text-brand-900">
                3. Choose the client folders folder
              </h2>
              <p className="text-sm text-neutral-700">
                Open the folder that contains one folder per client (for example “Test, Todd”), then
                choose “Use this folder”.
              </p>
              <div className="rounded-xl bg-brand-50 p-4">
                <p className="font-medium text-brand-900">
                  {isLibraryTop ? `${library.name} (top level)` : folder.name}
                </p>
                <p className="text-sm text-neutral-600">
                  {children.length} folder{children.length === 1 ? '' : 's'} inside
                  {children.length
                    ? `: ${children
                        .slice(0, 6)
                        .map((c) => c.name)
                        .join(', ')}${children.length > 6 ? '…' : ''}`
                    : ''}
                </p>
                <div className="mt-3">
                  <ActionButtonForm
                    action={connectSharePointAction}
                    hidden={{
                      site: site.id,
                      drive: library.id,
                      folder: isLibraryTop ? '' : folder.id,
                    }}
                    label="Use this folder for client folders"
                    pendingLabel="Connecting…"
                    variant="primary"
                    confirm={
                      status.location
                        ? 'Change where client folders live? Clients already linked to folders elsewhere will need to be re-linked.'
                        : undefined
                    }
                  />
                </div>
              </div>
              {children.length ? (
                <FolderList
                  items={children.map((c) => ({
                    id: c.id,
                    name: c.name,
                    sub:
                      c.childCount !== null
                        ? `${c.childCount} item${c.childCount === 1 ? '' : 's'}`
                        : null,
                  }))}
                  link={(id) => href({ site: site!.id, drive: library!.id, folder: id })}
                />
              ) : null}
            </>
          ) : null}

          <form className="space-y-2 border-t border-neutral-100 pt-4" action="/admin/sharepoint">
            <label htmlFor="link" className="block text-sm font-medium text-neutral-800">
              Or paste the SharePoint link to the client folders
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="link"
                name="link"
                type="url"
                inputMode="url"
                defaultValue={link}
                placeholder="https://yourtenant.sharepoint.com/sites/…"
                maxLength={1000}
              />
              <button type="submit" className={buttonClass('secondary')}>
                Find
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Open the folder in SharePoint and copy the address from the browser bar.
            </p>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
