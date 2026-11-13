/* eslint-disable no-console */
/**
 * The only logger the app uses. It writes one JSON line per event with an event name and
 * a small allowlist of ID and enum fields. Every other key is dropped and strings are
 * truncated, so file contents, codes, tokens, upload URLs and emails never reach Vercel
 * logs (CLAUDE.md security rule 5).
 */

type Fields = Record<string, string | number | boolean | null | undefined>;

const ALLOWED_KEYS = new Set([
  'requestId',
  'uploadId',
  'clientId',
  'adminId',
  'documentTypeId',
  'itemId',
  'status',
  'statusCode',
  'graphCode',
  'reason',
  'action',
  'attempt',
  'durationMs',
  'sizeBytes',
  'pageCount',
  'mime',
  'route',
]);

export function sanitizeFields(
  fields: Fields = {},
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!ALLOWED_KEYS.has(key)) continue;
    out[key] = typeof value === 'string' ? value.slice(0, 120) : value;
  }
  return out;
}

function write(level: 'info' | 'warn' | 'error', event: string, fields?: Fields) {
  const line = JSON.stringify({
    level,
    event,
    ...sanitizeFields(fields),
    at: new Date().toISOString(),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};
