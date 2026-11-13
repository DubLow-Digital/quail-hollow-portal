/**
 * Shapes shared by the admin file browser's data sources (SharePoint and the sample tree).
 * Pure types and helpers only, so they can be unit tested without Graph.
 */

export interface ExplorerItem {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  /** Bytes for files; total size for folders when SharePoint reports it. */
  size: number | null;
  childCount: number | null;
  mime: string | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
  webUrl: string | null;
  /** Folder that contains the item (used by search results to link to it). */
  parentId: string | null;
}

export interface Crumb {
  id: string;
  name: string;
}

export interface ExplorerFolder {
  id: string;
  name: string;
  /** From the client root down to this folder, inclusive. */
  trail: Crumb[];
  webUrl: string | null;
  items: ExplorerItem[];
  /** True when the listing hit the cap and more items exist. */
  truncated: boolean;
}

export interface FileSource {
  mode: 'sharepoint' | 'sample';
  rootId: string;
  listFolder(folderId?: string | null): Promise<ExplorerFolder>;
  search(folderId: string, query: string): Promise<ExplorerItem[]>;
  /** A short-lived link straight to the file in SharePoint, or null when there is none. */
  downloadUrl(itemId: string): Promise<string | null>;
}

/** Thrown when an item is missing or sits outside the client folders area. */
export class ExplorerAccessError extends Error {}

/** Drive item IDs (and sample IDs) are short and URL-safe; anything else is rejected early. */
export const DRIVE_ITEM_ID = /^[A-Za-z0-9!_.-]{1,200}$/;

export const ROOT_LABEL = 'All clients';

/** Folders first, then files, each alphabetically (case-insensitive, numbers in order). */
export function sortItems(items: ExplorerItem[]): ExplorerItem[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
  });
}

/** Cleans a search box value: trimmed, single-spaced, at most 100 characters. */
export function cleanSearch(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/** A short label for the file type column, from the extension. */
export function fileKindLabel(name: string, mime: string | null): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const byExt: Record<string, string> = {
    pdf: 'PDF',
    jpg: 'Photo',
    jpeg: 'Photo',
    png: 'Image',
    heic: 'Photo',
    heif: 'Photo',
    webp: 'Image',
    gif: 'Image',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    csv: 'CSV',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',
    txt: 'Text',
    zip: 'Zip',
    qbb: 'QuickBooks',
    qbw: 'QuickBooks',
  };
  if (byExt[ext]) return byExt[ext];
  if (mime?.startsWith('image/')) return 'Image';
  return ext ? ext.toUpperCase() : 'File';
}
