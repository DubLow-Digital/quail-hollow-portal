/**
 * Supabase auth cookies are only read on the server (there is no browser Supabase client),
 * so they are httpOnly to keep tokens out of reach of page scripts.
 */
export const SUPABASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/** Supabase stores sessions in cookies named `sb-<project-ref>-auth-token` (optionally chunked). */
export function isSupabaseAuthCookie(name: string): boolean {
  return (
    /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i.test(name) ||
    /^sb-[a-z0-9-]+-auth-token-code-verifier$/i.test(name)
  );
}
