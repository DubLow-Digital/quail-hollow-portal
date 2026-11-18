import type { EntityType } from '@/lib/db/types';

/**
 * Starter documents for a client added automatically when their first invoice goes out.
 * Pure module. The bundles are found by name, so renaming a bundle in the admin means
 * updating STARTER_BUNDLES here too (the portal skips a bundle it cannot find).
 */

export const STARTER_BUNDLES = {
  individual: 'New individual tax client',
  business: 'New business client',
} as const;

export interface StarterPlan {
  /** Bundle names to request, in order. */
  bundles: string[];
  /** Tax year for documents that need one: the year before the firm's current year. */
  taxYear: number;
  /** Business name for documents filed per business, or null when the record has none. */
  businessName: string | null;
}

function same(a: string, b: string): boolean {
  return (
    a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')
  );
}

/**
 * A business name is the record title, unless the title is just the person's name (Notion
 * titles individual clients by name).
 */
export function businessNameFrom(
  company: string | null | undefined,
  person: { first_name: string; last_name: string },
): string | null {
  const name = (company ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) return null;
  const first = person.first_name.trim();
  const last = person.last_name.trim();
  if (
    same(name, `${first} ${last}`) ||
    same(name, `${last}, ${first}`) ||
    same(name, `${last} ${first}`)
  )
    return null;
  return name;
}

export function starterPlan(
  entityTypes: readonly EntityType[],
  person: { first_name: string; last_name: string; company?: string | null },
  firmToday: string,
): StarterPlan {
  const bundles: string[] = [];
  if (entityTypes.includes('individual')) bundles.push(STARTER_BUNDLES.individual);
  if (entityTypes.some((t) => t !== 'individual')) bundles.push(STARTER_BUNDLES.business);
  return {
    bundles,
    taxYear: Number(firmToday.slice(0, 4)) - 1,
    businessName: businessNameFrom(person.company, person),
  };
}
