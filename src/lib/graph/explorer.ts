import 'server-only';
import { graphEnv } from '@/lib/env';
import {
  ExplorerAccessError,
  ROOT_LABEL,
  sortItems,
  type Crumb,
  type ExplorerFolder,
  type ExplorerItem,
  type FileSource,
} from '@/lib/files/explorer-types';
import { GraphError, graphRequest } from './client';

/**
 * Read-only file browsing for admins, confined to the client folders area
 * (SP_CLIENT_ROOT_FOLDER_ID). Every folder and file is checked to sit under that root
 * before it is listed or downloaded. File bytes never pass through the portal: downloads
 * redirect the admin's browser to SharePoint's own short-lived link.
 */

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string }; application?: { displayName?: string } };
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string; id?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

const SELECT =
  'id,name,size,webUrl,lastModifiedDateTime,lastModifiedBy,folder,file,parentReference';
const MAX_ITEMS = 1000;
const MAX_DEPTH = 15;
const SEARCH_LIMIT = 50;

function drive(suffix: string): string {
  return `/drives/${encodeURIComponent(graphEnv().SP_DRIVE_ID)}${suffix}`;
}

function toItem(g: GraphItem): ExplorerItem {
  return {
    id: g.id,
    name: g.name,
    kind: g.folder ? 'folder' : 'file',
    size: typeof g.size === 'number' ? g.size : null,
    childCount: g.folder?.childCount ?? null,
    mime: g.file?.mimeType ?? null,
    modifiedAt: g.lastModifiedDateTime ?? null,
    modifiedBy:
      g.lastModifiedBy?.user?.displayName ?? g.lastModifiedBy?.application?.displayName ?? null,
    webUrl: g.webUrl ?? null,
    parentId: g.parentReference?.id ?? null,
  };
}

async function getItem(itemId: string): Promise<GraphItem | null> {
  return graphRequest<GraphItem>(drive(`/items/${encodeURIComponent(itemId)}?$select=${SELECT}`), {
    allow404: true,
  });
}

/**
 * Walks up from an item to the client root. Returns the folder trail from the root down to
 * the item's parent (or the item itself for folders), or throws if the item is outside.
 */
async function trailToRoot(item: GraphItem, includeSelf: boolean): Promise<Crumb[]> {
  const env = graphEnv();
  const rootId = env.SP_CLIENT_ROOT_FOLDER_ID;
  if (item.parentReference?.driveId && item.parentReference.driveId !== env.SP_DRIVE_ID) {
    throw new ExplorerAccessError('outside_drive');
  }
  const crumbs: Crumb[] = includeSelf ? [{ id: item.id, name: item.name }] : [];
  if (item.id === rootId) return [{ id: rootId, name: ROOT_LABEL }];

  let parentId = item.parentReference?.id;
  for (let depth = 0; depth < MAX_DEPTH && parentId; depth++) {
    if (parentId === rootId) {
      crumbs.push({ id: rootId, name: ROOT_LABEL });
      return crumbs.reverse();
    }
    const parent = await getItem(parentId);
    if (!parent) break;
    crumbs.push({ id: parent.id, name: parent.name });
    parentId = parent.parentReference?.id;
  }
  throw new ExplorerAccessError('outside_root');
}

async function listChildren(
  folderId: string,
): Promise<{ items: ExplorerItem[]; truncated: boolean }> {
  const items: ExplorerItem[] = [];
  let next: string | null = drive(
    `/items/${encodeURIComponent(folderId)}/children?$select=${SELECT}&$top=200`,
  );
  while (next) {
    const page: { value: GraphItem[]; '@odata.nextLink'?: string } | null =
      await graphRequest(next);
    if (!page) break;
    for (const g of page.value) items.push(toItem(g));
    next = page['@odata.nextLink'] ?? null;
    if (items.length >= MAX_ITEMS) return { items: sortItems(items), truncated: !!next };
  }
  return { items: sortItems(items), truncated: false };
}

/** Only SharePoint's own host may receive the admin's browser (same rule as uploads). */
export function isSharePointDownloadUrl(value: string, expectedHost?: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (expectedHost ? host === expectedHost.toLowerCase() : host.endsWith('.sharepoint.com'))
    );
  } catch {
    return false;
  }
}

/** Escapes a search term for Graph's search(q='...') function. */
export function graphSearchSegment(query: string): string {
  return `search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')`;
}

export const sharePointSource: FileSource = {
  mode: 'sharepoint',
  get rootId() {
    return graphEnv().SP_CLIENT_ROOT_FOLDER_ID;
  },

  async listFolder(folderId) {
    const id = folderId || graphEnv().SP_CLIENT_ROOT_FOLDER_ID;
    const folder = await getItem(id);
    if (!folder?.folder) throw new ExplorerAccessError('not_found');
    const trail = await trailToRoot(folder, true);
    const { items, truncated } = await listChildren(folder.id);
    return {
      id: folder.id,
      name: trail[trail.length - 1]!.name,
      trail,
      webUrl: folder.webUrl ?? null,
      items,
      truncated,
    } satisfies ExplorerFolder;
  },

  async search(folderId, query) {
    const folder = await getItem(folderId);
    if (!folder?.folder) throw new ExplorerAccessError('not_found');
    await trailToRoot(folder, true);
    const page = await graphRequest<{ value: GraphItem[] }>(
      drive(
        `/items/${encodeURIComponent(folder.id)}/${graphSearchSegment(query)}?$select=${SELECT}&$top=${SEARCH_LIMIT}`,
      ),
    );
    // Search is already scoped to the folder's subtree; keep the drive check anyway.
    return sortItems(
      (page?.value ?? [])
        .filter(
          (g) =>
            !g.parentReference?.driveId || g.parentReference.driveId === graphEnv().SP_DRIVE_ID,
        )
        .map(toItem),
    );
  },

  async downloadUrl(itemId) {
    // No $select here: the default response carries the short-lived download link.
    const item = await graphRequest<GraphItem>(drive(`/items/${encodeURIComponent(itemId)}`), {
      allow404: true,
    });
    if (!item) throw new ExplorerAccessError('not_found');
    if (!item.file) return null;
    await trailToRoot(item, false);
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) return null;
    if (!isSharePointDownloadUrl(url, graphEnv().SP_HOSTNAME)) {
      throw new GraphError(502, 'unexpected_download_host', 'Download link host is not SharePoint');
    }
    return url;
  },
};
