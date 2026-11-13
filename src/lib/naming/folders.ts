/**
 * SharePoint folder naming and target-subfolder resolution. Pure module.
 *
 * Standard client structure (created by "Create folder" in admin):
 *   {LastName}, {FirstName}/
 *     Individual/ID, Individual/Tax Returns, Individual/Income Documents
 *     Businesses/
 *     Dependents/
 * Year and business subfolders are created on demand when a document arrives.
 */

export class FolderPathError extends Error {}

const INVALID_CHARS = /["*:<>?/\\|#%\u0000-\u001f]/g;
const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
  'desktop.ini',
  'forms',
]);
const MAX_SEGMENT = 120;

/** Cleans one folder name so SharePoint accepts it. Throws if nothing usable remains. */
export function sanitizeFolderSegment(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(INVALID_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s~$]+|[.\s]+$/g, '')
    .slice(0, MAX_SEGMENT)
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new FolderPathError('Folder name is empty after removing unsupported characters.');
  }
  if (RESERVED.has(cleaned.toLowerCase()) || cleaned.toLowerCase().startsWith('_vti_')) {
    throw new FolderPathError(`"${cleaned}" is a reserved name in SharePoint.`);
  }
  return cleaned;
}

/** "Smith, Jane" */
export function clientFolderName(firstName: string, lastName: string): string {
  return sanitizeFolderSegment(`${lastName.trim()}, ${firstName.trim()}`);
}

export const STANDARD_SUBFOLDERS: readonly string[][] = [
  ['Individual', 'ID'],
  ['Individual', 'Tax Returns'],
  ['Individual', 'Income Documents'],
  ['Businesses'],
  ['Dependents'],
];

export const SUBFOLDER_TOKENS = ['{year}', '{business}'] as const;

export function subfolderNeedsYear(template: string): boolean {
  return template.includes('{year}');
}

export function subfolderNeedsBusiness(template: string): boolean {
  return template.includes('{business}');
}

/** Validates an admin-entered target subfolder template such as "Individual/Tax Returns/{year}". */
export function validateSubfolderTemplate(template: string): void {
  if (template.length > 300) throw new FolderPathError('Subfolder path is too long.');
  if (template.trim() === '') return;
  const stripped = template.replace(/\{year\}|\{business\}/g, 'X');
  if (/[{}]/.test(stripped)) {
    throw new FolderPathError('Only {year} and {business} placeholders are supported.');
  }
  for (const segment of template.split('/')) {
    if (segment.trim() === '') throw new FolderPathError('Subfolder path has an empty segment.');
    if (segment.includes('{year}') || segment.includes('{business}')) continue;
    sanitizeFolderSegment(segment);
    if (sanitizeFolderSegment(segment) !== segment.trim()) {
      throw new FolderPathError(`"${segment}" contains characters SharePoint does not allow.`);
    }
  }
}

export interface SubfolderValues {
  taxYear?: number | null | undefined;
  businessName?: string | null | undefined;
  /** Used for {year} when a document type does not require a tax year. */
  now?: Date | undefined;
}

/**
 * Turns a target subfolder template into clean path segments relative to the client's
 * folder. {year} uses the request's tax year (or the current year when none is set);
 * {business} requires the request's business name.
 */
export function resolveSubfolder(template: string, values: SubfolderValues): string[] {
  validateSubfolderTemplate(template);
  if (template.trim() === '') return [];
  const year =
    values.taxYear ??
    Number(
      new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/New_York' }).format(
        values.now ?? new Date(),
      ),
    );
  const business = values.businessName?.trim() ?? '';
  if (subfolderNeedsBusiness(template) && !business) {
    throw new FolderPathError('This document type needs a business name on the request.');
  }
  return template
    .split('/')
    .map((segment) => segment.replaceAll('{year}', String(year)).replaceAll('{business}', business))
    .map(sanitizeFolderSegment);
}
