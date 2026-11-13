// Concatenates supabase/migrations into supabase/setup-all.sql for pasting into the
// Supabase SQL editor when the CLI cannot be used. Run: npm run db:bundle
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function bundleMigrations(root = process.cwd()) {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const header = [
    '-- GENERATED FILE. Do not edit; run `npm run db:bundle` after changing a migration.',
    '-- Paste into the Supabase SQL editor of a NEW project and run once.',
    '-- Contains every migration in supabase/migrations, in order. No test or seed data.',
    '',
  ].join('\n');
  return (
    header +
    files.map((f) => `\n-- >>> ${f}\n${readFileSync(join(dir, f), 'utf8').trimEnd()}\n`).join('')
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(join(process.cwd(), 'supabase', 'setup-all.sql'), bundleMigrations());
  console.log('Wrote supabase/setup-all.sql');
}
