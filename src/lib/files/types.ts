/**
 * File type rules shared by the browser (to filter pickers and fail fast) and the server
 * (the authority). Pure module, safe to import anywhere.
 */

export const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
  'image/webp': ['webp'],
  'image/tiff': ['tif', 'tiff'],
  'text/csv': ['csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/msword': ['doc'],
};

export const SUPPORTED_MIME_TYPES = Object.keys(MIME_EXTENSIONS);

export const MIME_LABELS: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG photo',
  'image/png': 'PNG image',
  'image/heic': 'iPhone photo (HEIC)',
  'image/heif': 'HEIF photo',
  'image/webp': 'WebP image',
  'image/tiff': 'TIFF image',
  'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-excel': 'Excel (older)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word (older)',
};

export const MAX_PAGE_COUNT = 100;

export function isSupportedMime(mime: string): boolean {
  return Object.hasOwn(MIME_EXTENSIONS, mime);
}

/** The extension the server writes for a MIME type (the client never chooses it). */
export function canonicalExtension(mime: string): string {
  const exts = MIME_EXTENSIONS[mime];
  if (!exts || exts.length === 0) throw new Error('Unsupported file type');
  return exts[0]!;
}

export function extensionOf(filename: string): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Browsers sometimes report an empty or generic MIME type (notably for HEIC and some
 * Office files). Fall back to the extension in that case.
 */
export function effectiveMime(reportedMime: string, filename: string): string {
  const mime = reportedMime.trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream' && isSupportedMime(mime)) return mime;
  const ext = extensionOf(filename);
  if (!ext) return mime;
  for (const [candidate, exts] of Object.entries(MIME_EXTENSIONS)) {
    if (exts.includes(ext)) return candidate;
  }
  return mime;
}

export type FileCheckError =
  'empty_file' | 'file_too_large' | 'type_not_allowed' | 'extension_mismatch' | 'too_many_pages';

export interface FileCheckInput {
  mime: string;
  sizeBytes: number;
  /** Original filename from the device, used only to compare the extension. */
  originalName?: string | undefined;
  pageCount?: number | undefined;
}

export interface FileRules {
  acceptedMime: readonly string[];
  maxMb: number;
}

export function checkFileAgainstRules(
  input: FileCheckInput,
  rules: FileRules,
): FileCheckError | null {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return 'empty_file';
  if (input.sizeBytes > rules.maxMb * 1024 * 1024) return 'file_too_large';
  if (!isSupportedMime(input.mime) || !rules.acceptedMime.includes(input.mime))
    return 'type_not_allowed';
  if (input.originalName) {
    const ext = extensionOf(input.originalName);
    if (ext && !MIME_EXTENSIONS[input.mime]!.includes(ext)) return 'extension_mismatch';
  }
  if (input.pageCount !== undefined && (input.pageCount < 1 || input.pageCount > MAX_PAGE_COUNT)) {
    return 'too_many_pages';
  }
  return null;
}

export const FILE_ERROR_MESSAGES: Record<FileCheckError, string> = {
  empty_file: 'That file is empty. Please try again.',
  file_too_large: 'That file is too large. Please choose a smaller file or scan fewer pages.',
  type_not_allowed: 'That type of file is not accepted for this request.',
  extension_mismatch:
    'That file does not look like the type it claims to be. Please choose another file.',
  too_many_pages: 'Too many pages. Please split this into smaller uploads.',
};

/** Value for an <input accept> attribute. */
export function acceptAttribute(acceptedMime: readonly string[]): string {
  const parts = new Set<string>();
  for (const mime of acceptedMime) {
    parts.add(mime);
    for (const ext of MIME_EXTENSIONS[mime] ?? []) parts.add(`.${ext}`);
  }
  return [...parts].join(',');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
