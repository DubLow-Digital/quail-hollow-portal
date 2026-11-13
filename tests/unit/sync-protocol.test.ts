import { describe, expect, it } from 'vitest';
import {
  MAX_SKEW_SECONDS,
  clientTypeFor,
  entityTypesFor,
  inboundChanges,
  inboundClientSchema,
  normalizeGhlId,
  normalizeNotionId,
  notionPageUrl,
  signRequest,
  verifyRequest,
} from '@/lib/sync/protocol';

const SECRET = 'x'.repeat(40);
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ origin: 'ghl', client: { email: 'todd.test@example.test' } });

describe('request signing', () => {
  it('verifies a request signed with the same secret, method, path and body', () => {
    const { timestamp, signature } = signRequest(SECRET, 'post', '/api/sync/clients', BODY, NOW);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(
      verifyRequest(SECRET, 'POST', '/api/sync/clients', BODY, timestamp, signature, NOW),
    ).toEqual({ ok: true });
  });

  it('rejects a changed body, path, method or secret', () => {
    const { timestamp, signature } = signRequest(SECRET, 'POST', '/api/sync/clients', BODY, NOW);
    const bad = (s: string, m: string, p: string, b: string) =>
      verifyRequest(s, m, p, b, timestamp, signature, NOW);
    expect(bad(SECRET, 'POST', '/api/sync/clients', BODY + ' ')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(bad(SECRET, 'POST', '/api/portal/client', BODY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(bad(SECRET, 'PUT', '/api/sync/clients', BODY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(bad('y'.repeat(40), 'POST', '/api/sync/clients', BODY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects stale or missing timestamps and signatures', () => {
    const { timestamp, signature } = signRequest(SECRET, 'POST', '/p', BODY, NOW);
    expect(
      verifyRequest(SECRET, 'POST', '/p', BODY, timestamp, signature, NOW + MAX_SKEW_SECONDS + 1),
    ).toEqual({ ok: false, reason: 'stale' });
    expect(verifyRequest(SECRET, 'POST', '/p', BODY, null, signature, NOW)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifyRequest(SECRET, 'POST', '/p', BODY, timestamp, null, NOW)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifyRequest(SECRET, 'POST', '/p', BODY, 'abc', signature, NOW)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('identifiers', () => {
  it('normalizes Notion page IDs to the dashed form', () => {
    expect(normalizeNotionId('8E6838CD47174AA88BC44B72DE83AF68')).toBe(
      '8e6838cd-4717-4aa8-8bc4-4b72de83af68',
    );
    expect(normalizeNotionId('8e6838cd-4717-4aa8-8bc4-4b72de83af68')).toBe(
      '8e6838cd-4717-4aa8-8bc4-4b72de83af68',
    );
    expect(normalizeNotionId('not-an-id')).toBeNull();
    expect(notionPageUrl('8e6838cd-4717-4aa8-8bc4-4b72de83af68')).toBe(
      'https://www.notion.so/8e6838cd47174aa88bc44b72de83af68',
    );
  });

  it('accepts only plain Lead Alchemist contact IDs', () => {
    expect(normalizeGhlId(' AbC123xyz ')).toBe('AbC123xyz');
    expect(normalizeGhlId('../contacts')).toBeNull();
    expect(normalizeGhlId('')).toBeNull();
  });
});

describe('field mapping', () => {
  it('maps entity types to the Notion client type and back', () => {
    expect(clientTypeFor(['individual'])).toBe('Individual');
    expect(clientTypeFor(['schedule_c'])).toBe('Business');
    expect(clientTypeFor(['individual', '1120s'])).toBe('Business + Owner Personal');
    expect(entityTypesFor('Business + Owner Personal')).toEqual(['individual', 'other']);
    expect(entityTypesFor('Business')).toEqual(['other']);
    expect(entityTypesFor(undefined)).toEqual(['individual']);
  });

  it('never changes email and never blanks existing values', () => {
    const current = { first_name: 'Todd', last_name: 'Test', phone: '352-555-0100' };
    expect(
      inboundChanges(current, { email: 'new@example.test', first_name: null, phone: '' }),
    ).toEqual({});
    expect(
      inboundChanges(current, { first_name: 'Todd', last_name: 'Tester', phone: '352-555-0199' }),
    ).toEqual({
      last_name: 'Tester',
      phone: '352-555-0199',
    });
  });

  it('validates inbound payloads', () => {
    expect(
      inboundClientSchema.safeParse({ origin: 'ghl', client: { phone: 'call me; drop table' } })
        .success,
    ).toBe(false);
    expect(inboundClientSchema.safeParse({ origin: 'other', client: {} }).success).toBe(false);
    expect(
      inboundClientSchema.safeParse({
        origin: 'notion',
        client: { email: 'sam.sample@example.test' },
      }).success,
    ).toBe(true);
  });
});
