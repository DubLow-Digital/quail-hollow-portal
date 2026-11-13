import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { EntityType } from '@/lib/db/types';

/**
 * The portal <-> quail-hollow-sync protocol. The sync service owns the Notion and Lead
 * Alchemist connections; the portal only holds one shared secret (SYNC_HUB_SECRET).
 *
 * Every request in either direction is signed:
 *   X-QH-Timestamp: unix seconds
 *   X-QH-Signature: v1=hex(HMAC-SHA256(secret, "v1:{timestamp}:{METHOD}:{path}:{body}"))
 * Binding the method and path stops a captured body being replayed at another endpoint,
 * and the timestamp limits replay to a 5 minute window. Pure functions only.
 * The same algorithm lives in quail-hollow-sync/lib/portal.js.
 */

export const SIGNATURE_HEADER = 'x-qh-signature';
export const TIMESTAMP_HEADER = 'x-qh-timestamp';
export const MAX_SKEW_SECONDS = 300;
export const MAX_BODY_BYTES = 16 * 1024;

export function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { timestamp: string; signature: string } {
  const timestamp = String(nowSeconds);
  const mac = createHmac('sha256', secret)
    .update(`v1:${timestamp}:${method.toUpperCase()}:${path}:${body}`)
    .digest('hex');
  return { timestamp, signature: `v1=${mac}` };
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'bad_signature' };

export function verifyRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp: string | null,
  signature: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp) || !signature.startsWith('v1=')) {
    return { ok: false, reason: 'missing' };
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS)
    return { ok: false, reason: 'stale' };
  const expected = signRequest(secret, method, path, body, Number(timestamp)).signature;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Identifiers and field mapping
// ---------------------------------------------------------------------------

/** Notion page IDs, normalized to the dashed lowercase form. Returns null if invalid. */
export function normalizeNotionId(value: string | null | undefined): string | null {
  const hex = String(value ?? '')
    .toLowerCase()
    .replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeGhlId(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  return /^[A-Za-z0-9]{6,64}$/.test(v) ? v : null;
}

export function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

/** Portal entity types -> the Notion "Client Type" select used by the firm's CRM. */
export function clientTypeFor(entityTypes: readonly EntityType[]): string {
  const personal = entityTypes.includes('individual');
  const business = entityTypes.some((t) => t !== 'individual');
  if (personal && business) return 'Business + Owner Personal';
  return business ? 'Business' : 'Individual';
}

/** Notion "Client Type" -> portal entity types (Aleida can refine the business type). */
export function entityTypesFor(clientType: string | null | undefined): EntityType[] {
  switch ((clientType ?? '').trim()) {
    case 'Business':
      return ['other'];
    case 'Business + Owner Personal':
      return ['individual', 'other'];
    default:
      return ['individual'];
  }
}

const name = z.string().trim().min(1).max(100);
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+().\-\s]*$/);

/** What the sync service sends when a linked Notion or Lead Alchemist record changes. */
export const inboundClientSchema = z.object({
  origin: z.enum(['notion', 'ghl']),
  client: z.object({
    portal_id: z.uuid().nullish(),
    notion_page_id: z.string().max(40).nullish(),
    ghl_contact_id: z.string().max(64).nullish(),
    email: z.email().max(254).nullish(),
    first_name: name.nullish(),
    last_name: name.nullish(),
    phone: phone.nullish(),
  }),
});
export type InboundClient = z.infer<typeof inboundClientSchema>;

/** A Notion client or Lead Alchemist contact offered for import. */
export const candidateSchema = z.object({
  source: z.enum(['notion', 'ghl']),
  id: z.string().min(1).max(64),
  first_name: z.string().max(100).nullish(),
  last_name: z.string().max(100).nullish(),
  email: z.string().max(254).nullish(),
  phone: z.string().max(40).nullish(),
  company: z.string().max(200).nullish(),
  client_type: z.string().max(60).nullish(),
  status: z.string().max(60).nullish(),
  notion_page_id: z.string().max(40).nullish(),
  ghl_contact_id: z.string().max(64).nullish(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const pushResponseSchema = z.object({
  ok: z.literal(true),
  notion_page_id: z.string().max(40).nullish(),
  ghl_contact_id: z.string().max(64).nullish(),
  notion: z.enum(['created', 'updated', 'skipped', 'error']).optional(),
  ghl: z.enum(['created', 'updated', 'skipped', 'error']).optional(),
});

export interface ClientFields {
  first_name: string;
  last_name: string;
  phone: string | null;
}

/**
 * Decides what an inbound update may change on a portal client. Email is never changed
 * from outside (it is the client's sign-in identity), and blank values never erase data.
 */
export function inboundChanges(
  current: ClientFields,
  incoming: InboundClient['client'],
): Partial<ClientFields> {
  const changes: Partial<ClientFields> = {};
  if (incoming.first_name && incoming.first_name !== current.first_name)
    changes.first_name = incoming.first_name;
  if (incoming.last_name && incoming.last_name !== current.last_name)
    changes.last_name = incoming.last_name;
  if (incoming.phone && incoming.phone !== (current.phone ?? '')) changes.phone = incoming.phone;
  return changes;
}
