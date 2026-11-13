import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAMING_TEMPLATE,
  NamingTemplateError,
  buildFilename,
  cleanFilenamePart,
  firmDateStamp,
  titleCaseName,
  validateNamingTemplate,
} from '@/lib/naming/filename';
import {
  FolderPathError,
  clientFolderName,
  resolveSubfolder,
  sanitizeFolderSegment,
  validateSubfolderTemplate,
} from '@/lib/naming/folders';

// Noon UTC on Nov 12, 2026 is 7 AM in Ocala.
const NOV_12 = new Date('2026-11-12T12:00:00Z');

const base = {
  firstName: 'Jane',
  lastName: 'Smith',
  docSlug: 'DriversLicense',
  extension: 'pdf',
  date: NOV_12,
};

describe('buildFilename', () => {
  it('matches the brief examples', () => {
    expect(buildFilename(DEFAULT_NAMING_TEMPLATE, base)).toBe(
      'JSmith_DriversLicense_2026-11-12.pdf',
    );
    expect(
      buildFilename(DEFAULT_NAMING_TEMPLATE, { ...base, docSlug: 'FederalReturn', taxYear: 2025 }),
    ).toBe('JSmith_FederalReturn_2025_2026-11-12.pdf');
  });

  it('produces the acceptance-test name for a photo', () => {
    expect(
      buildFilename(DEFAULT_NAMING_TEMPLATE, {
        ...base,
        firstName: 'Todd',
        lastName: 'Test',
        extension: 'jpg',
      }),
    ).toBe('TTest_DriversLicense_2026-11-12.jpg');
  });

  it('drops the optional tax year group when there is no year', () => {
    expect(buildFilename(DEFAULT_NAMING_TEMPLATE, { ...base, taxYear: null })).toBe(
      'JSmith_DriversLicense_2026-11-12.pdf',
    );
  });

  it('uses the firm time zone for the date stamp', () => {
    // 02:30 UTC on Nov 13 is still Nov 12 in Florida.
    const lateEvening = new Date('2026-11-13T02:30:00Z');
    expect(buildFilename(DEFAULT_NAMING_TEMPLATE, { ...base, date: lateEvening })).toBe(
      'JSmith_DriversLicense_2026-11-12.pdf',
    );
    expect(firmDateStamp(new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30');
  });

  it('title-cases and cleans names', () => {
    const name = (lastName: string, firstName = 'jane') =>
      buildFilename(DEFAULT_NAMING_TEMPLATE, { ...base, firstName, lastName });
    expect(name('smith')).toBe('JSmith_DriversLicense_2026-11-12.pdf');
    expect(name('SMITH')).toBe('JSmith_DriversLicense_2026-11-12.pdf');
    expect(name('McDonald')).toBe('JMcDonald_DriversLicense_2026-11-12.pdf');
    expect(name("o'brien")).toBe('JOBrien_DriversLicense_2026-11-12.pdf');
    expect(name('de la cruz')).toBe('JDeLaCruz_DriversLicense_2026-11-12.pdf');
    expect(name('smith-jones')).toBe('JSmith-Jones_DriversLicense_2026-11-12.pdf');
    expect(name('Peña', 'Ángela')).toBe('APena_DriversLicense_2026-11-12.pdf');
  });

  it('strips characters that could break paths or inject structure', () => {
    const result = buildFilename(DEFAULT_NAMING_TEMPLATE, {
      ...base,
      lastName: '../../etc/passwd',
      firstName: '<script>',
    });
    expect(result).toMatch(/^[A-Za-z0-9_-]+\.pdf$/);
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('supports custom templates per document type', () => {
    expect(
      buildFilename('{LastName}-{FirstName}_{DocSlug}[_{Business}][_{TaxYear}].{ext}', {
        ...base,
        docSlug: 'BusinessReturn',
        businessName: 'acme widgets, llc',
        taxYear: 2025,
      }),
    ).toBe('Smith-Jane_BusinessReturn_AcmeWidgetsLlc_2025.pdf');
  });

  it('rejects invalid extensions', () => {
    expect(() => buildFilename(DEFAULT_NAMING_TEMPLATE, { ...base, extension: 'p/df' })).toThrow(
      NamingTemplateError,
    );
  });
});

describe('validateNamingTemplate', () => {
  it('accepts the default template', () => {
    expect(() => validateNamingTemplate(DEFAULT_NAMING_TEMPLATE)).not.toThrow();
  });

  it.each([
    ['{LastName}_{DocSlug}', 'must end with'],
    ['{LastName}_{Unknown}.{ext}', 'Unknown token'],
    ['{LastName}[_[{TaxYear}]].{ext}', 'nested'],
    ['{LastName}[_{TaxYear}.{ext}', 'Unclosed'],
    ['{LastName}/{DocSlug}.{ext}', 'not allowed'],
    ['{LastName} {DocSlug}.{ext}', 'not allowed'],
    ['{LastName}.x.{ext}', 'Only the final'],
    ['static_name.{ext}', 'at least one token'],
    ['{LastName}[_static].{ext}', 'must contain a token'],
  ])('rejects %s', (template, message) => {
    expect(() => validateNamingTemplate(template)).toThrow(message);
  });
});

describe('name helpers', () => {
  it('cleanFilenamePart keeps only safe characters', () => {
    expect(cleanFilenamePart('W-2 (copy) #1')).toBe('W-2copy1');
  });

  it('titleCaseName handles edge cases', () => {
    expect(titleCaseName('  van der  berg ')).toBe('VanDerBerg');
    expect(titleCaseName('')).toBe('');
  });
});

describe('folders', () => {
  it('names client folders "Last, First"', () => {
    expect(clientFolderName('Jane', 'Smith')).toBe('Smith, Jane');
    expect(clientFolderName(' Jane ', 'Smith/Jones')).toBe('Smith Jones, Jane');
  });

  it('sanitizes SharePoint-invalid characters', () => {
    expect(sanitizeFolderSegment('A:B*C?')).toBe('A B C');
    expect(sanitizeFolderSegment('  Acme, LLC.  ')).toBe('Acme, LLC');
    expect(() => sanitizeFolderSegment('..')).toThrow(FolderPathError);
    expect(() => sanitizeFolderSegment('///')).toThrow(FolderPathError);
    expect(() => sanitizeFolderSegment('CON')).toThrow(FolderPathError);
    expect(() => sanitizeFolderSegment('_vti_bin')).toThrow(FolderPathError);
  });

  it('resolves year and business placeholders', () => {
    expect(resolveSubfolder('Individual/Tax Returns/{year}', { taxYear: 2025 })).toEqual([
      'Individual',
      'Tax Returns',
      '2025',
    ]);
    expect(
      resolveSubfolder('Businesses/{business}/{year}', {
        taxYear: 2024,
        businessName: 'Acme: Widgets',
      }),
    ).toEqual(['Businesses', 'Acme Widgets', '2024']);
    expect(resolveSubfolder('Individual/ID', {})).toEqual(['Individual', 'ID']);
    expect(resolveSubfolder('', {})).toEqual([]);
  });

  it('uses the current year when no tax year is set', () => {
    expect(resolveSubfolder('Income/{year}', { now: NOV_12 })).toEqual(['Income', '2026']);
  });

  it('requires a business name for business folders', () => {
    expect(() => resolveSubfolder('Businesses/{business}', {})).toThrow(FolderPathError);
  });

  it('cannot be tricked into leaving the client folder', () => {
    expect(() => resolveSubfolder('Businesses/{business}', { businessName: '..' })).toThrow(
      FolderPathError,
    );
    expect(
      resolveSubfolder('Businesses/{business}', { businessName: '../../Other, Client' }),
    ).toEqual(['Businesses', 'Other, Client']);
  });

  it('validates admin-entered subfolder templates', () => {
    expect(() => validateSubfolderTemplate('Individual/Tax Returns/{year}')).not.toThrow();
    expect(() => validateSubfolderTemplate('Individual//ID')).toThrow(FolderPathError);
    expect(() => validateSubfolderTemplate('Individual/{client}')).toThrow(FolderPathError);
    expect(() => validateSubfolderTemplate('Individual/ID?')).toThrow(FolderPathError);
  });
});
