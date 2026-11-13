import { describe, expect, it } from 'vitest';
import {
  acceptAttribute,
  canonicalExtension,
  checkFileAgainstRules,
  effectiveMime,
  extensionOf,
} from '@/lib/files/types';

const rules = { acceptedMime: ['application/pdf', 'image/jpeg', 'image/png'], maxMb: 50 };

describe('file rules', () => {
  it('accepts an allowed file within the size limit', () => {
    expect(
      checkFileAgainstRules(
        { mime: 'application/pdf', sizeBytes: 40 * 1024 * 1024, originalName: 'scan.pdf' },
        rules,
      ),
    ).toBeNull();
  });

  it('enforces the max size', () => {
    expect(
      checkFileAgainstRules({ mime: 'application/pdf', sizeBytes: 50 * 1024 * 1024 + 1 }, rules),
    ).toBe('file_too_large');
    expect(checkFileAgainstRules({ mime: 'application/pdf', sizeBytes: 0 }, rules)).toBe(
      'empty_file',
    );
  });

  it('enforces the accepted types', () => {
    expect(checkFileAgainstRules({ mime: 'image/heic', sizeBytes: 10 }, rules)).toBe(
      'type_not_allowed',
    );
    expect(checkFileAgainstRules({ mime: 'text/html', sizeBytes: 10 }, rules)).toBe(
      'type_not_allowed',
    );
  });

  it('rejects a mismatched extension', () => {
    expect(
      checkFileAgainstRules(
        { mime: 'application/pdf', sizeBytes: 10, originalName: 'invoice.exe' },
        rules,
      ),
    ).toBe('extension_mismatch');
  });

  it('bounds page counts', () => {
    expect(
      checkFileAgainstRules({ mime: 'application/pdf', sizeBytes: 10, pageCount: 0 }, rules),
    ).toBe('too_many_pages');
    expect(
      checkFileAgainstRules({ mime: 'application/pdf', sizeBytes: 10, pageCount: 101 }, rules),
    ).toBe('too_many_pages');
  });

  it('derives MIME from extension when the browser reports none', () => {
    expect(effectiveMime('', 'IMG_0001.HEIC')).toBe('image/heic');
    expect(effectiveMime('application/octet-stream', 'statement.pdf')).toBe('application/pdf');
    expect(effectiveMime('image/jpeg', 'photo.jpg')).toBe('image/jpeg');
  });

  it('picks the canonical extension on the server', () => {
    expect(canonicalExtension('image/jpeg')).toBe('jpg');
    expect(canonicalExtension('application/pdf')).toBe('pdf');
    expect(() => canonicalExtension('text/html')).toThrow();
  });

  it('builds accept attributes', () => {
    expect(acceptAttribute(['application/pdf'])).toBe('application/pdf,.pdf');
  });

  it('parses extensions', () => {
    expect(extensionOf('a.b.PDF')).toBe('pdf');
    expect(extensionOf('noext')).toBeNull();
  });
});
