import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClient } from '@/lib/auth/client';
import { safeNextPath } from '@/lib/auth/routes';
import { ClientFooter, ClientHeader } from '@/components/client/brand';
import { Alert } from '@/components/ui';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; signedout?: string; next?: string }>;
}) {
  const params = await searchParams;
  const existing = await getClient().catch(() => null);
  if (existing) redirect('/');

  return (
    <div className="min-h-dvh">
      <ClientHeader />
      <main className="mx-auto max-w-md px-4 pt-8">
        <h1 className="font-serif text-2xl font-semibold text-brand-900">
          Sign in to send your documents
        </h1>
        <p className="mt-2 text-neutral-700">
          Enter the email address we have on file. We will send you a one-time code. No password
          needed.
        </p>
        <div className="mt-4 space-y-3">
          {params.expired ? (
            <Alert tone="warning">
              For your security you were signed out. Please sign in again.
            </Alert>
          ) : null}
          {params.signedout ? <Alert tone="success">You are signed out.</Alert> : null}
        </div>
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <LoginForm next={safeNextPath(params.next ?? null)} />
        </div>
      </main>
      <ClientFooter />
    </div>
  );
}
