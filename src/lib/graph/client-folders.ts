import 'server-only';
import { graphEnv } from '@/lib/env';
import { STANDARD_SUBFOLDERS, clientFolderName } from '@/lib/naming/folders';
import { GraphError, graphRequest } from './client';
import { ensureFolderPath, getItem, type DriveItem } from './drive';

/**
 * Client folder linking and creation, always constrained to the configured client root
 * folder (SP_CLIENT_ROOT_FOLDER_ID).
 */

export class FolderLinkError extends Error {}

const MAX_DEPTH = 12;

export interface LinkedFolder {
  id: string;
  /** Path relative to the client root, e.g. "Smith, Jane". */
  relativePath: string;
  webUrl: string | null;
}

/**
 * Confirms a folder lives under the client root by walking up its parents, and returns its
 * path relative to the root. Throws FolderLinkError otherwise.
 */
export async function resolveFolderUnderRoot(folderId: string): Promise<LinkedFolder> {
  const rootId = graphEnv().SP_CLIENT_ROOT_FOLDER_ID;
  const item = await getItem(folderId);
  if (!item?.folder) throw new FolderLinkError('That folder no longer exists.');
  if (item.id === rootId)
    throw new FolderLinkError('Choose a client folder, not the top-level folder.');

  const names = [item.name];
  let parentId = item.parentReference?.id;
  for (let depth = 0; depth < MAX_DEPTH && parentId; depth++) {
    if (parentId === rootId) {
      return { id: item.id, relativePath: names.reverse().join('/'), webUrl: item.webUrl ?? null };
    }
    const parent: DriveItem | null = await getItem(parentId);
    if (!parent) break;
    names.push(parent.name);
    parentId = parent.parentReference?.id;
  }
  throw new FolderLinkError('That folder is outside the client folders area.');
}

/**
 * Creates "{Last}, {First}" under the client root with the standard subfolders. Refuses if
 * a folder with that name already exists, so two different clients with the same name are
 * never merged by accident (use "Link existing folder" instead).
 */
export async function createStandardClientFolder(
  firstName: string,
  lastName: string,
): Promise<LinkedFolder> {
  const env = graphEnv();
  const name = clientFolderName(firstName, lastName);
  let created: DriveItem | null;
  try {
    created = await graphRequest<DriveItem>(
      `/drives/${encodeURIComponent(env.SP_DRIVE_ID)}/items/${encodeURIComponent(env.SP_CLIENT_ROOT_FOLDER_ID)}/children`,
      { method: 'POST', body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } },
    );
  } catch (err) {
    if (err instanceof GraphError && err.status === 409) {
      throw new FolderLinkError(
        `A folder named "${name}" already exists. Use "Link existing folder" if it belongs to this client.`,
      );
    }
    throw err;
  }
  if (!created) throw new FolderLinkError('SharePoint did not return the new folder.');

  for (const segments of STANDARD_SUBFOLDERS) {
    await ensureFolderPath(created.id, segments);
  }
  return { id: created.id, relativePath: name, webUrl: created.webUrl ?? null };
}
