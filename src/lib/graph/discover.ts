import 'server-only';
import { graphCredentialsEnv } from '@/lib/env';
import { GraphError, graphRequest, graphToken } from './client';

/**
 * Connect SharePoint: everything here runs as the portal's own Entra app (client
 * credentials). No person's Microsoft account is used. With the Sites.Selected permission
 * the app can only see the site(s) it has been granted, which is what we show.
 */

export interface SiteSummary {
  id: string;
  name: string;
  webUrl: string | null;
  hostname: string | null;
}
export interface LibrarySummary {
  id: string;
  name: string;
  webUrl: string | null;
}
export interface FolderSummary {
  id: string;
  name: string;
  childCount: number | null;
  webUrl: string | null;
}

export type AppCheck =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'sign_in_failed' | 'unavailable'; detail?: string };

/** Can the portal's app sign in to Microsoft at all (tenant, app ID and secret correct)? */
export async function checkAppSignIn(): Promise<AppCheck> {
  try {
    graphCredentialsEnv();
  } catch {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    await graphToken();
    return { ok: true };
  } catch (err) {
    const code = (err as { errorCode?: string }).errorCode ?? (err as Error).name;
    // MSAL error codes such as invalid_client or unauthorized_client; no secrets in them.
    const offline = /network|timeout|ENOTFOUND|ECONN/i.test(String(code));
    return {
      ok: false,
      reason: offline ? 'unavailable' : 'sign_in_failed',
      detail: String(code).slice(0, 60),
    };
  }
}

interface GraphSite {
  id: string;
  displayName?: string;
  name?: string;
  webUrl?: string;
  siteCollection?: { hostname?: string };
}

const toSite = (s: GraphSite): SiteSummary => ({
  id: s.id,
  name: s.displayName || s.name || 'Site',
  webUrl: s.webUrl ?? null,
  hostname: s.siteCollection?.hostname ?? (s.webUrl ? new URL(s.webUrl).hostname : null),
});

/**
 * Sites the app can reach on its own. With Sites.Selected, listing returns only granted
 * sites (or nothing); the tenant's root site is checked too. Errors are swallowed: an empty
 * list means "no access granted yet".
 */
export async function reachableSites(): Promise<SiteSummary[]> {
  const found = new Map<string, SiteSummary>();
  const attempts = [
    graphRequest<{ value: GraphSite[] }>(
      '/sites?$select=id,displayName,name,webUrl,siteCollection&$top=50',
    )
      .then((r) => r?.value ?? [])
      .catch(() => [] as GraphSite[]),
    graphRequest<GraphSite>('/sites/root?$select=id,displayName,name,webUrl,siteCollection', {
      allow404: true,
    })
      .then((r) => (r ? [r] : []))
      .catch(() => [] as GraphSite[]),
  ];
  for (const list of await Promise.all(attempts)) {
    for (const s of list) if (s?.id) found.set(s.id, toSite(s));
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export class LinkError extends Error {
  constructor(
    readonly reason: 'invalid_link' | 'no_access' | 'not_found' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Pure: turns a SharePoint link into the host and server-relative path it points at.
 * Handles the address bar of a library view (…/Forms/AllItems.aspx?id=/sites/x/Shared Documents/y)
 * and plain folder links. Sharing links (/:f:/…) are not supported: they need broader access.
 */
export function parseSharePointLink(link: string): {
  host: string;
  path: string;
  sitePath: string;
} {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new LinkError('invalid_link', 'That is not a web address.');
  }
  if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('.sharepoint.com')) {
    throw new LinkError(
      'invalid_link',
      'Use a link that starts with https:// and is on sharepoint.com.',
    );
  }
  if (/^\/:[a-z]:\//i.test(url.pathname)) {
    throw new LinkError(
      'invalid_link',
      'That is a sharing link. Open the folder in SharePoint and copy the address from the browser instead.',
    );
  }
  const idParam = url.searchParams.get('id') ?? url.searchParams.get('RootFolder');
  let path = idParam ?? decodeURIComponent(url.pathname);
  path = path
    .replace(/\/Forms\/[^/]+\.aspx$/i, '')
    .replace(/\/[^/]+\.aspx$/i, '')
    .replace(/\/+$/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  const m = /^\/(sites|teams)\/([^/]+)/i.exec(path);
  const sitePath = m ? `/${m[1]}/${m[2]}` : '';
  return { host: url.hostname.toLowerCase(), path, sitePath };
}

function linkErrorFrom(err: unknown): never {
  if (err instanceof LinkError) throw err;
  if (err instanceof GraphError) {
    if (err.status === 401 || err.status === 403)
      throw new LinkError(
        'no_access',
        'The portal app has not been given access to this site yet.',
      );
    if (err.status === 404)
      throw new LinkError('not_found', 'SharePoint could not find that site or folder.');
  }
  throw new LinkError('unavailable', 'SharePoint did not respond. Please try again in a moment.');
}

/** Finds the site, library and folder a pasted link points at. */
export async function resolveLink(link: string): Promise<{
  site: SiteSummary;
  library: LibrarySummary;
  folder: FolderSummary;
}> {
  const { host, path, sitePath } = parseSharePointLink(link);
  try {
    const siteRef = sitePath ? `/sites/${host}:${encodeURI(sitePath)}` : `/sites/${host}`;
    const site = await graphRequest<GraphSite>(
      `${siteRef}?$select=id,displayName,name,webUrl,siteCollection`,
    );
    if (!site?.id) throw new LinkError('not_found', 'SharePoint could not find that site.');
    const libraries = await listLibraries(site.id);
    // The library whose address is the longest prefix of the link's path.
    const decodedPath = path.toLowerCase();
    const library = libraries
      .map((l) => ({
        l,
        p: l.webUrl ? decodeURIComponent(new URL(l.webUrl).pathname).toLowerCase() : '',
      }))
      .filter(({ p }) => p && (decodedPath === p || decodedPath.startsWith(`${p}/`)))
      .sort((a, b) => b.p.length - a.p.length)[0];
    if (!library) {
      throw new LinkError(
        'not_found',
        'That link does not point inside a document library on this site.',
      );
    }
    const libPath = decodeURIComponent(new URL(library.l.webUrl!).pathname);
    const rest = path.slice(libPath.length).replace(/^\/+/, '');
    const folder = rest
      ? await graphRequest<GraphFolder>(
          `/drives/${encodeURIComponent(library.l.id)}/root:/${rest.split('/').map(encodeURIComponent).join('/')}:?$select=id,name,folder,webUrl`,
        )
      : await graphRequest<GraphFolder>(
          `/drives/${encodeURIComponent(library.l.id)}/root?$select=id,name,folder,webUrl`,
        );
    if (!folder?.folder)
      throw new LinkError('not_found', 'That link points to a file, not a folder.');
    return { site: toSite(site), library: library.l, folder: toFolder(folder) };
  } catch (err) {
    linkErrorFrom(err);
  }
}

interface GraphFolder {
  id: string;
  name: string;
  folder?: { childCount?: number };
  webUrl?: string;
  parentReference?: { driveId?: string };
}
const toFolder = (f: GraphFolder): FolderSummary => ({
  id: f.id,
  name: f.name,
  childCount: f.folder?.childCount ?? null,
  webUrl: f.webUrl ?? null,
});

export async function getSite(siteId: string): Promise<SiteSummary> {
  try {
    const s = await graphRequest<GraphSite>(
      `/sites/${encodeURIComponent(siteId)}?$select=id,displayName,name,webUrl,siteCollection`,
    );
    if (!s?.id) throw new LinkError('not_found', 'Site not found.');
    return toSite(s);
  } catch (err) {
    linkErrorFrom(err);
  }
}

export async function listLibraries(siteId: string): Promise<LibrarySummary[]> {
  const r = await graphRequest<{
    value: { id: string; name: string; webUrl?: string; driveType?: string }[];
  }>(`/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl,driveType`);
  return (r?.value ?? [])
    .filter((d) => !d.driveType || d.driveType === 'documentLibrary')
    .map((d) => ({ id: d.id, name: d.name, webUrl: d.webUrl ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A folder in a library (null = the library's top level) and its child folders. */
export async function browseFolder(
  driveId: string,
  folderId: string | null,
): Promise<{ folder: FolderSummary; children: FolderSummary[]; driveIdOk: boolean }> {
  try {
    const base = `/drives/${encodeURIComponent(driveId)}`;
    const item = await graphRequest<GraphFolder>(
      folderId
        ? `${base}/items/${encodeURIComponent(folderId)}?$select=id,name,folder,webUrl,parentReference`
        : `${base}/root?$select=id,name,folder,webUrl,parentReference`,
    );
    if (!item?.folder) throw new LinkError('not_found', 'Folder not found.');
    const kids = await graphRequest<{ value: GraphFolder[] }>(
      `${base}/items/${encodeURIComponent(item.id)}/children?$select=id,name,folder,webUrl&$top=200`,
    );
    const children = (kids?.value ?? [])
      .filter((c) => c.folder)
      .map(toFolder)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    return {
      folder: toFolder(item),
      children,
      driveIdOk: !item.parentReference?.driveId || item.parentReference.driveId === driveId,
    };
  } catch (err) {
    linkErrorFrom(err);
  }
}

/** Graph Explorer request that grants the portal app write access to one site (run once by a Global Admin). */
export function grantInstructions(siteId: string | null): {
  method: string;
  url: string;
  body: string;
} {
  let clientId = '<portal app client ID>';
  try {
    clientId = graphCredentialsEnv().MS_PORTAL_CLIENT_ID;
  } catch {
    // not configured
  }
  return {
    method: 'POST',
    url: `https://graph.microsoft.com/v1.0/sites/${siteId ?? '{site-id}'}/permissions`,
    body: JSON.stringify(
      {
        roles: ['write'],
        grantedToIdentities: [
          { application: { id: clientId, displayName: 'Quail Hollow Client Portal' } },
        ],
      },
      null,
      2,
    ),
  };
}
