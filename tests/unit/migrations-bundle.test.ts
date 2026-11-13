import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { bundleMigrations } from '../../scripts/bundle-migrations.mjs';

describe('supabase/setup-all.sql', () => {
  it('matches the migrations (run `npm run db:bundle` if this fails)', () => {
    const root = join(import.meta.dirname, '..', '..');
    expect(readFileSync(join(root, 'supabase', 'setup-all.sql'), 'utf8')).toBe(
      bundleMigrations(root),
    );
  });
});
