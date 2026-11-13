/**
 * Pure checks applied to the SharePoint item after the browser finishes uploading, before
 * the upload is accepted. Kept free of I/O so it is unit tested directly.
 */

export interface ExpectedUpload {
  finalFilename: string;
  targetFolderId: string;
  driveId: string;
  declaredSize: number;
  maxBytes: number;
  startedAt: string;
}

export interface UploadedItemFacts {
  id: string;
  name: string;
  size?: number | undefined;
  isFile: boolean;
  parentId?: string | undefined;
  parentDriveId?: string | undefined;
  createdDateTime?: string | undefined;
}

export type VerifyFailure =
  'not_a_file' | 'wrong_folder' | 'wrong_name' | 'size_mismatch' | 'too_large' | 'stale_item';

/**
 * With conflictBehavior "rename", SharePoint keeps our name or appends " 1", " 2" … before
 * the extension. Anything else means the item is not the one we created.
 */
export function nameMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const dot = expected.lastIndexOf('.');
  const stem = dot === -1 ? expected : expected.slice(0, dot);
  const ext = dot === -1 ? '' : expected.slice(dot);
  if (!actual.startsWith(`${stem} `) || !actual.endsWith(ext)) return false;
  const middle = actual.slice(stem.length + 1, actual.length - ext.length);
  return /^\d{1,4}$/.test(middle);
}

export function verifyUploadedItem(
  item: UploadedItemFacts,
  expected: ExpectedUpload,
): VerifyFailure | null {
  if (!item.isFile) return 'not_a_file';
  if (item.parentId !== expected.targetFolderId || item.parentDriveId !== expected.driveId)
    return 'wrong_folder';
  if (!nameMatches(item.name, expected.finalFilename)) return 'wrong_name';
  if (typeof item.size !== 'number' || item.size > expected.maxBytes) return 'too_large';
  if (item.size !== expected.declaredSize) return 'size_mismatch';
  if (item.createdDateTime) {
    const created = Date.parse(item.createdDateTime);
    const started = Date.parse(expected.startedAt);
    // Allow for clock differences between SharePoint and our database.
    if (Number.isFinite(created) && Number.isFinite(started) && created < started - 5 * 60 * 1000) {
      return 'stale_item';
    }
  }
  return null;
}
