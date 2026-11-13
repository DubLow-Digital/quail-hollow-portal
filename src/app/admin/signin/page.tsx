import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/auth/admin';
import { safeNextPath } from '@/lib/auth/routes';
import { Alert, Card } from '@/components/ui';
import { BrandLogo } from '@/components/client/brand';

export const metadata: Metadata = { title: 'Admin sign in' };

const ERRORS: Record<string, string> = {
  denied: 'That Microsoft account is not allowed to use the admin area.',
  failed: 'Sign-in did not complete. Please try again.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again in a few minutes.',
};

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string; signedout?: string; next?: string }>;
}) {
  const params = await searchParams;
  const admin = await getAdmin().catch(() => null);
  if (admin) redirect('/admin');

  const next = safeNextPath(params.next ?? null);
  const href = `/api/auth/signin/microsoft${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Card className="space-y-5">
        <div>
          <BrandLogo size="sm" />
          <h1 className="mt-5 font-serif text-2xl font-semibold text-brand-900">Admin sign in</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Use your Quail Hollow Microsoft account. Only approved staff can sign in.
          </p>
        </div>
        {params.error && ERRORS[params.error] ? (
          <Alert tone="error">{ERRORS[params.error]}</Alert>
        ) : null}
        {params.expired ? (
          <Alert tone="warning">Your session ended. Please sign in again.</Alert>
        ) : null}
        {params.signedout ? <Alert tone="success">You are signed out.</Alert> : null}
        {/* A plain link (GET), so the redirect to Microsoft is not limited by form-action CSP. */}
        <a
          href={href}
          className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-brand-700 px-4 text-base font-medium text-white hover:bg-brand-800"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 21 21">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </a>
      </Card>
    </main>
  );
}
