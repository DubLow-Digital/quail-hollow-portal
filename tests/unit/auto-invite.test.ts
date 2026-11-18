import { describe, expect, it } from 'vitest';
import { STARTER_BUNDLES, businessNameFrom, starterPlan } from '@/lib/requests/starter';
import { entityTypesFor, inviteRequestSchema } from '@/lib/sync/protocol';

const JANE = { first_name: 'Jane', last_name: 'Sample' };

describe('starter documents for an automatic invite', () => {
  it('requests the individual bundle for an individual, for last tax year', () => {
    const plan = starterPlan(
      entityTypesFor('Individual'),
      { ...JANE, company: 'Jane Sample' },
      '2026-11-18',
    );
    expect(plan).toEqual({
      bundles: [STARTER_BUNDLES.individual],
      taxYear: 2025,
      businessName: null,
    });
  });

  it('requests the business bundle for a business, named after the record', () => {
    const plan = starterPlan(
      entityTypesFor('Business'),
      { ...JANE, company: 'Sample Landscaping LLC' },
      '2027-01-02',
    );
    expect(plan).toEqual({
      bundles: [STARTER_BUNDLES.business],
      taxYear: 2026,
      businessName: 'Sample Landscaping LLC',
    });
  });

  it('requests both bundles for a business owner who is also a personal client', () => {
    const plan = starterPlan(
      entityTypesFor('Business + Owner Personal'),
      { ...JANE, company: 'Sample Landscaping LLC' },
      '2026-11-18',
    );
    expect(plan.bundles).toEqual([STARTER_BUNDLES.individual, STARTER_BUNDLES.business]);
  });

  it('treats an unknown or missing client type as an individual', () => {
    expect(starterPlan(entityTypesFor(null), JANE, '2026-11-18').bundles).toEqual([
      STARTER_BUNDLES.individual,
    ]);
  });

  it("never uses the person's own name as a business name", () => {
    for (const title of ['Jane Sample', 'sample, jane', 'Sample  Jane', '  ', null]) {
      expect(businessNameFrom(title, JANE)).toBeNull();
    }
    expect(businessNameFrom('  Sample   Farms  ', JANE)).toBe('Sample Farms');
    expect(businessNameFrom('x'.repeat(300), JANE)).toHaveLength(120);
  });
});

describe('the invite request from the sync service', () => {
  it('needs a Notion record and accepts missing optional fields', () => {
    expect(
      inviteRequestSchema.safeParse({ client: { notion_page_id: '0'.repeat(32) } }).success,
    ).toBe(true);
    expect(inviteRequestSchema.safeParse({ client: {} }).success).toBe(false);
    expect(inviteRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects oversized fields', () => {
    expect(
      inviteRequestSchema.safeParse({
        client: { notion_page_id: '0'.repeat(32), company: 'x'.repeat(201) },
      }).success,
    ).toBe(false);
  });
});
