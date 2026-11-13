import { describe, expect, it } from 'vitest';
import { nameMatches, verifyUploadedItem } from '@/lib/uploads/verify';
import { sanitizeMetadata } from '@/lib/audit';

const expected = {
  finalFilename: 'TTest_DriversLicense_2026-11-12.jpg',
  targetFolderId: 'FOLDER',
  driveId: 'b!drive',
  declaredSize: 1000,
  maxBytes: 25 * 1024 * 1024,
  startedAt: '2026-11-12T15:00:00Z',
};
const good = {
  id: 'ITEM',
  name: 'TTest_DriversLicense_2026-11-12.jpg',
  size: 1000,
  isFile: true,
  parentId: 'FOLDER',
  parentDriveId: 'b!drive',
  createdDateTime: '2026-11-12T15:00:05Z',
};

describe('verifyUploadedItem', () => {
  it('accepts the item we asked Graph to create', () => {
    expect(verifyUploadedItem(good, expected)).toBeNull();
  });

  it('accepts a SharePoint conflict rename', () => {
    expect(
      verifyUploadedItem({ ...good, name: 'TTest_DriversLicense_2026-11-12 1.jpg' }, expected),
    ).toBeNull();
  });

  it.each([
    [{ isFile: false }, 'not_a_file'],
    [{ parentId: 'OTHER' }, 'wrong_folder'],
    [{ parentDriveId: 'b!other' }, 'wrong_folder'],
    [{ name: 'Something_else.jpg' }, 'wrong_name'],
    [{ size: 999 }, 'size_mismatch'],
    [{ size: 26 * 1024 * 1024 }, 'too_large'],
    [{ size: undefined }, 'too_large'],
    [{ createdDateTime: '2026-11-01T00:00:00Z' }, 'stale_item'],
  ])('rejects %o as %s', (patch, reason) => {
    expect(verifyUploadedItem({ ...good, ...patch }, expected)).toBe(reason);
  });
});

describe('nameMatches', () => {
  it('only allows our name or a numeric rename suffix', () => {
    expect(nameMatches('A_B.pdf', 'A_B.pdf')).toBe(true);
    expect(nameMatches('A_B 2.pdf', 'A_B.pdf')).toBe(true);
    expect(nameMatches('A_B 2.jpg', 'A_B.pdf')).toBe(false);
    expect(nameMatches('A_B copy.pdf', 'A_B.pdf')).toBe(false);
    expect(nameMatches('A_B 1 2.pdf', 'A_B.pdf')).toBe(false);
  });
});

describe('audit metadata', () => {
  it('keeps MIME types but never URLs', () => {
    expect(sanitizeMetadata({ mime: 'application/pdf', capture: 'https://evil.example' })).toEqual({
      mime: 'application/pdf',
    });
  });
});
