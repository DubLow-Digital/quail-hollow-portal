/**
 * Builds Quail Hollow's final filenames from a per-document-type template.
 *
 * Default: {FirstInitial}{LastName}_{DocSlug}[_{TaxYear}]_{YYYY-MM-DD}.{ext}
 *   -> JSmith_DriversLicense_2026-11-12.pdf
 *   -> JSmith_FederalReturn_2025_2026-11-12.pdf
 *
 * Grammar: literal characters [A-Za-z0-9_-], tokens in {Braces}, and optional groups in
 * [brackets] that are dropped unless every token inside has a value. Templates must end
 * with ".{ext}". The client never influences the filename except through their own name
 * on file, which is normalized here.
 */

export const DEFAULT_NAMING_TEMPLATE =
  '{FirstInitial}{LastName}_{DocSlug}[_{TaxYear}]_{YYYY-MM-DD}.{ext}';

export const NAMING_TOKENS = [
  'FirstInitial',
  'FirstName',
  'LastName',
  'DocSlug',
  'TaxYear',
  'Business',
  'YYYY-MM-DD',
  'ext',
] as const;

export type NamingToken = (typeof NAMING_TOKENS)[number];

const TOKEN_SET: ReadonlySet<string> = new Set(NAMING_TOKENS);
const MAX_STEM_LENGTH = 150;
export const FIRM_TIME_ZONE = 'America/New_York';

export interface NamingInput {
  firstName: string;
  lastName: string;
  docSlug: string;
  taxYear?: number | null | undefined;
  businessName?: string | null | undefined;
  extension: string;
  date: Date;
}

type Part = { kind: 'text'; value: string } | { kind: 'token'; name: NamingToken };
type Node = Part | { kind: 'optional'; parts: Part[] };

export class NamingTemplateError extends Error {}

function parse(template: string): Node[] {
  const nodes: Node[] = [];
  let current: Part[] | null = null;
  let i = 0;
  const push = (part: Part) => (current ? current.push(part) : nodes.push(part));

  while (i < template.length) {
    const ch = template[i]!;
    if (ch === '[') {
      if (current) throw new NamingTemplateError('Optional groups cannot be nested.');
      current = [];
      i++;
    } else if (ch === ']') {
      if (!current) throw new NamingTemplateError('Unmatched "]".');
      if (!current.some((p) => p.kind === 'token')) {
        throw new NamingTemplateError('Optional groups must contain a token.');
      }
      nodes.push({ kind: 'optional', parts: current });
      current = null;
      i++;
    } else if (ch === '{') {
      const end = template.indexOf('}', i);
      if (end === -1) throw new NamingTemplateError('Unclosed "{".');
      const name = template.slice(i + 1, end);
      if (!TOKEN_SET.has(name)) throw new NamingTemplateError(`Unknown token {${name}}.`);
      push({ kind: 'token', name: name as NamingToken });
      i = end + 1;
    } else if (/[A-Za-z0-9_.-]/.test(ch)) {
      push({ kind: 'text', value: ch });
      i++;
    } else {
      throw new NamingTemplateError(`Character "${ch}" is not allowed in a filename template.`);
    }
  }
  if (current) throw new NamingTemplateError('Unclosed "[".');
  return nodes;
}

/** Throws NamingTemplateError with a readable message when the template is unusable. */
export function validateNamingTemplate(template: string): void {
  if (template.length === 0 || template.length > 200) {
    throw new NamingTemplateError('Template must be between 1 and 200 characters.');
  }
  if (!template.endsWith('.{ext}')) {
    throw new NamingTemplateError('Template must end with ".{ext}".');
  }
  const stem = template.slice(0, -'.{ext}'.length);
  if (stem.includes('.'))
    throw new NamingTemplateError('Only the final ".{ext}" may contain a dot.');
  if (stem.includes('{ext}')) throw new NamingTemplateError('{ext} may only appear at the end.');
  const nodes = parse(stem);
  const hasToken = nodes.some((n) => n.kind === 'token' || n.kind === 'optional');
  if (!hasToken) throw new NamingTemplateError('Template must use at least one token.');
}

/** Strips accents, then anything outside letters, digits, hyphen and underscore. */
export function cleanFilenamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9_-]+/g, '');
}

/**
 * Title-cases a personal name for filenames: "smith" -> "Smith", "SMITH" -> "Smith",
 * "McDonald" stays "McDonald", "o'brien" -> "OBrien", "de la cruz" -> "DeLaCruz",
 * "smith-jones" -> "Smith-Jones". Accents are removed ("Peña" -> "Pena").
 */
export function titleCaseName(value: string): string {
  const ascii = value.normalize('NFKD').replace(/\p{M}+/gu, '');
  return ascii
    .split('-')
    .map((hyphenPart) =>
      hyphenPart
        .split(/[\s'’`.]+/)
        .filter(Boolean)
        .map((word) => {
          const letters = word.replace(/[^A-Za-z0-9]/g, '');
          if (!letters) return '';
          const isUniformCase =
            letters === letters.toLowerCase() || letters === letters.toUpperCase();
          const rest = isUniformCase ? letters.slice(1).toLowerCase() : letters.slice(1);
          return letters[0]!.toUpperCase() + rest;
        })
        .join(''),
    )
    .filter(Boolean)
    .join('-');
}

/** YYYY-MM-DD for the given instant in the firm's time zone (Ocala, Florida). */
export function firmDateStamp(date: Date, timeZone = FIRM_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function tokenValues(input: NamingInput): Record<NamingToken, string> {
  const first = titleCaseName(input.firstName);
  const last = titleCaseName(input.lastName);
  const year =
    input.taxYear !== null && input.taxYear !== undefined && Number.isInteger(input.taxYear)
      ? String(input.taxYear)
      : '';
  return {
    FirstInitial: first
      .replace(/[^A-Za-z0-9]/g, '')
      .charAt(0)
      .toUpperCase(),
    FirstName: cleanFilenamePart(first),
    LastName: cleanFilenamePart(last),
    DocSlug: cleanFilenamePart(input.docSlug),
    TaxYear: /^\d{4}$/.test(year) ? year : '',
    Business: cleanFilenamePart(titleCaseName(input.businessName ?? '')),
    'YYYY-MM-DD': firmDateStamp(input.date),
    ext: input.extension,
  };
}

export function buildFilename(template: string, input: NamingInput): string {
  validateNamingTemplate(template);
  const ext = input.extension.toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new NamingTemplateError('Invalid file extension.');

  const values = tokenValues({ ...input, extension: ext });
  const nodes = parse(template.slice(0, -'.{ext}'.length));
  const render = (part: Part) => (part.kind === 'text' ? part.value : values[part.name]);

  let stem = '';
  for (const node of nodes) {
    if (node.kind === 'optional') {
      const complete = node.parts.every((p) => p.kind === 'text' || values[p.name] !== '');
      if (complete) stem += node.parts.map(render).join('');
    } else {
      stem += render(node);
    }
  }

  stem = cleanFilenamePart(stem)
    .replace(/_{2,}/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/[_-]+$/g, '');

  if (!stem) throw new NamingTemplateError('The template produced an empty filename.');
  return `${stem}.${ext}`;
}
