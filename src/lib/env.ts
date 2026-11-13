import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated lazily per feature group so that a missing variable
 * in one area (for example email) produces a clear error only where it is used.
 * Error messages name the missing variables but never echo their values.
 */

/**
 * process.env plus documented fallbacks:
 * - Vercel preview deployments use their branch URL when APP_BASE_URL is not set.
 * - Supabase's newer key names (publishable / secret), as injected by the Vercel
 *   Supabase integration, are accepted for the anon and service-role keys.
 */
export function resolvedEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const previewUrl =
    env.VERCEL_ENV === 'preview' && env.VERCEL_BRANCH_URL
      ? `https://${env.VERCEL_BRANCH_URL}`
      : undefined;
  return {
    ...env,
    APP_BASE_URL: env.APP_BASE_URL || previewUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
  };
}

function parseGroup<T extends z.ZodType>(group: string, schema: T): z.infer<T> {
  const result = schema.safeParse(resolvedEnv());
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? 'unknown')))];
    throw new Error(`Missing or invalid ${group} environment variables: ${names.join(', ')}`);
  }
  return result.data;
}

const nonEmpty = z.string().trim().min(1);

const emailList = z
  .string()
  .trim()
  .min(1)
  .transform((v) =>
    v
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()).min(1));

const appSchema = z.object({
  APP_BASE_URL: z.url().transform((v) => v.replace(/\/+$/, '')),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
});

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
});

const graphSchema = z.object({
  MS_TENANT_ID: nonEmpty,
  MS_PORTAL_CLIENT_ID: nonEmpty,
  MS_PORTAL_CLIENT_SECRET: nonEmpty,
  SP_SITE_ID: nonEmpty,
  SP_DRIVE_ID: nonEmpty,
  SP_CLIENT_ROOT_FOLDER_ID: nonEmpty,
  SP_HOSTNAME: z.string().trim().optional(),
});

const adminAuthSchema = z.object({
  MS_TENANT_ID: nonEmpty,
  MS_ADMIN_CLIENT_ID: nonEmpty,
  MS_ADMIN_CLIENT_SECRET: nonEmpty,
  /**
   * Authority tenant for admin sign-in. Defaults to MS_TENANT_ID (single tenant).
   * See docs/entra-setup.md for signing in admins from another tenant.
   */
  MS_ADMIN_AUTHORITY_TENANT: z.string().trim().optional(),
  /** Optional comma-separated list of extra tenant IDs admins may sign in from. */
  MS_ADMIN_ALLOWED_TENANTS: z.string().trim().optional(),
  ADMIN_ALLOWLIST: emailList,
});

const allowlistSchema = z.object({
  ADMIN_ALLOWLIST: emailList,
});

const emailSchema = z.object({
  RESEND_API_KEY: nonEmpty,
  EMAIL_FROM: nonEmpty,
  /** Who receives "new upload" notifications. Defaults to the first admin in ADMIN_ALLOWLIST. */
  ADMIN_NOTIFY_EMAILS: z.string().trim().optional(),
  ADMIN_ALLOWLIST: emailList,
});

type AppEnv = z.infer<typeof appSchema>;
type SupabaseEnv = z.infer<typeof supabaseSchema>;
type GraphEnv = z.infer<typeof graphSchema>;
type AdminAuthEnv = z.infer<typeof adminAuthSchema>;
type EmailEnv = z.infer<typeof emailSchema>;
type AllowlistEnv = z.infer<typeof allowlistSchema>;

const cache = new Map<string, unknown>();

function cached<T>(key: string, load: () => T): T {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as T;
}

export const appEnv = (): AppEnv => cached('app', () => parseGroup('app', appSchema));
export const supabaseEnv = (): SupabaseEnv =>
  cached('supabase', () => parseGroup('Supabase', supabaseSchema));
export const graphEnv = (): GraphEnv =>
  cached('graph', () => parseGroup('Microsoft Graph', graphSchema));
export const adminAuthEnv = (): AdminAuthEnv =>
  cached('adminAuth', () => parseGroup('admin sign-in', adminAuthSchema));
export const emailEnv = (): EmailEnv => cached('email', () => parseGroup('email', emailSchema));
export const allowlistEnv = (): AllowlistEnv =>
  cached('allowlist', () => parseGroup('admin allowlist', allowlistSchema));

/**
 * Backup admin sign-in with an emailed code (for when Microsoft sign-in is unavailable).
 * Off unless ADMIN_EMAIL_LOGIN is exactly "true". It is single-factor, so keep it off in
 * production once Microsoft sign-in works (see docs/security-summary.md).
 */
export function adminEmailLoginEnabled(): boolean {
  return process.env.ADMIN_EMAIL_LOGIN === 'true';
}

/** Test helper: forget cached values after mutating process.env. */
export function resetEnvCacheForTests(): void {
  cache.clear();
}
