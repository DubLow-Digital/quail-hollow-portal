import 'server-only';
import { graphEnv } from '@/lib/env';
import { sanitizeFolderSegment } from '@/lib/naming/folders';
import { GraphError, graphRequest } from './client';
import { graphMockOrigin } from './mock';

/**
 * SharePoint document library operations, always scoped to the single configured drive
 * (SP_DRIVE_ID). Folder and file names are built by our own code, never taken from
 * clients, and every path segment is encoded.
 */

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string; id?: string; path?: string };
}

export interface FolderSummary {
  id: string;
  name: string;
  childFolderCount: number | null;
  webUrl: string | null;
}

const ITEM_SELECT =
  '$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,folder,file,parentReference';
const MAX_CHILDREN = 2000;

function drivePath(suffix: string): string {
  return `/drives/${encodeURIComponent(graphEnv().SP_DRIVE_ID)}${suffix}`;
}

function encodePath(segments: readonly string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join('/');
}

export async function getItem(itemId: string): Promise<DriveItem | null> {
  return graphRequest<DriveItem>(drivePath(`/items/${encodeURIComponent(itemId)}?${ITEM_SELECT}`), {
    allow404: true,
  });
}

export async function getChildByPath(
  parentId: string,
  segments: readonly string[],
): Promise<DriveItem | null> {
  if (segments.length === 0) return getItem(parentId);
  return graphRequest<DriveItem>(
    drivePath(`/items/${encodeURIComponent(parentId)}:/${encodePath(segments)}:?${ITEM_SELECT}`),
    { allow404: true },
  );
}

/** Lists the child folders of a folder (paged, capped). Files are omitted. */
export async function listChildFolders(folderId: string): Promise<FolderSummary[]> {
  const folders: FolderSummary[] = [];
  let next: string | null = drivePath(
    `/items/${encodeURIComponent(folderId)}/children?$select=id,name,folder,webUrl&$top=200`,
  );
  let seen = 0;
  while (next && seen < MAX_CHILDREN) {
    const page: { value: DriveItem[]; '@odata.nextLink'?: string } | null =
      await graphRequest(next);
    if (!page) break;
    for (const item of page.value) {
      seen++;
      if (item.folder) {
        folders.push({
          id: item.id,
          name: item.name,
          childFolderCount: null,
          webUrl: item.webUrl ?? null,
        });
      }
    }
    next = page['@odata.nextLink'] ?? null;
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** Creates a folder, or returns the existing folder with that name. */
export async function ensureFolder(parentId: string, name: string): Promise<DriveItem> {
  const clean = sanitizeFolderSegment(name);
  const existing = await getChildByPath(parentId, [clean]);
  if (existing) {
    if (!existing.folder)
      throw new GraphError(409, 'not_a_folder', 'A file exists with that folder name');
    return existing;
  }
  try {
    const created = await graphRequest<DriveItem>(
      drivePath(`/items/${encodeURIComponent(parentId)}/children`),
      {
        method: 'POST',
        body: { name: clean, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      },
    );
    if (!created) throw new GraphError(500, 'empty_response', 'Folder creation returned no item');
    return created;
  } catch (err) {
    // Another request created it between our lookup and create.
    if (err instanceof GraphError && err.status === 409) {
      const raced = await getChildByPath(parentId, [clean]);
      if (raced?.folder) return raced;
    }
    throw err;
  }
}

/** Walks (and creates as needed) a relative folder path under `parentId`. */
export async function ensureFolderPath(
  parentId: string,
  segments: readonly string[],
): Promise<DriveItem> {
  const clean = segments.map(sanitizeFolderSegment);
  if (clean.length === 0) {
    const root = await getItem(parentId);
    if (!root?.folder) throw new GraphError(404, 'folder_not_found', 'Folder not found');
    return root;
  }
  // Fast path: the whole path usually exists already.
  const direct = await getChildByPath(parentId, clean);
  if (direct?.folder) return direct;

  let current = parentId;
  let item: DriveItem | null = null;
  for (const segment of clean) {
    item = await ensureFolder(current, segment);
    current = item.id;
  }
  return item!;
}

export interface UploadSession {
  uploadUrl: string;
  expirationDateTime: string;
}

/**
 * Creates a Graph upload session for a new file. With conflictBehavior "rename", Graph
 * appends a number if the name already exists. The returned URL is pre-authenticated:
 * it is handed to the browser once and never stored or logged.
 */
export async function createUploadSession(
  parentFolderId: string,
  filename: string,
  fileSize: number,
): Promise<UploadSession> {
  const session = await graphRequest<UploadSession>(
    drivePath(
      `/items/${encodeURIComponent(parentFolderId)}:/${encodeURIComponent(filename)}:/createUploadSession`,
    ),
    {
      method: 'POST',
      body: {
        item: { '@microsoft.graph.conflictBehavior': 'rename', name: filename, fileSize },
        deferCommit: false,
      },
    },
  );
  if (!session?.uploadUrl)
    throw new GraphError(500, 'no_upload_url', 'Graph did not return an upload URL');
  assertUploadHost(session.uploadUrl);
  return session;
}

/** The browser may only be sent to the tenant's SharePoint host (it is also the CSP allowance). */
export function assertUploadHost(uploadUrl: string): void {
  const url = new URL(uploadUrl);
  const mock = graphMockOrigin();
  if (mock && url.origin === mock) return;
  const expected = graphEnv().SP_HOSTNAME?.toLowerCase();
  const host = url.hostname.toLowerCase();
  const ok =
    url.protocol === 'https:' && (expected ? host === expected : host.endsWith('.sharepoint.com'));
  if (!ok)
    throw new GraphError(
      502,
      'unexpected_upload_host',
      'Upload URL host is not the configured SharePoint host',
    );
}

export async function deleteItem(itemId: string): Promise<void> {
  await graphRequest(drivePath(`/items/${encodeURIComponent(itemId)}`), {
    method: 'DELETE',
    allow404: true,
  });
}

/** True when `itemId` sits directly in `folderId` in the configured drive. */
export function isDirectChildOf(item: DriveItem, folderId: string): boolean {
  return (
    item.parentReference?.id === folderId &&
    item.parentReference?.driveId === graphEnv().SP_DRIVE_ID
  );
}
