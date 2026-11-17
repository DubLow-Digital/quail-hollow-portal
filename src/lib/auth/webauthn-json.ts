import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shapes of the passkey responses a browser sends back (W3C WebAuthn JSON, base64url fields).
 * Checked before they go to Supabase Auth, which verifies the signatures.
 */

type Passkey = SupabaseClient['auth']['passkey'];
export type AuthenticationCredential = Parameters<Passkey['verifyAuthentication']>[0]['credential'];
export type RegistrationCredential = Parameters<Passkey['verifyRegistration']>[0]['credential'];

const b64url = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9_-]*={0,2}$/);

const common = {
  id: b64url(1400).min(1),
  rawId: b64url(1400).min(1),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullish(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
};

export const authenticationCredentialSchema = z
  .object({
    ...common,
    response: z.object({
      clientDataJSON: b64url(4096).min(1),
      authenticatorData: b64url(4096).min(1),
      signature: b64url(1024).min(1),
      userHandle: b64url(512).nullish(),
    }),
  })
  .transform((v) => v as unknown as AuthenticationCredential);

export const registrationCredentialSchema = z
  .object({
    ...common,
    response: z.object({
      clientDataJSON: b64url(4096).min(1),
      attestationObject: b64url(16384).min(1),
      transports: z.array(z.string().max(20)).max(10).optional(),
      authenticatorData: b64url(16384).optional(),
      publicKey: b64url(4096).optional(),
      publicKeyAlgorithm: z.number().int().optional(),
    }),
  })
  .transform((v) => v as unknown as RegistrationCredential);
