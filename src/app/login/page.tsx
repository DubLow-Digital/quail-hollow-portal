import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClient } from '@/lib/auth/client';
import { safeNextPath } from '@/lib/auth/routes';
import { ClientFooter, ClientHeader, NestMark } from '@/components/client/brand';
import { Alert } from '@/components/ui';
import { clientSsoProviders } from '@/lib/env';
import { ClientSignIn } from './client-sign-in';

export const metadata: Metadata = { title: 'Sign in' };

const SSO_MESSAGES: Record<string, string> = {
  no_match:
    "That account's email is not on our list of people who can sign in. Use the email address we have for you, or ask your main contact or our office to add you.",
  unverified:
    'That account did not share a verified email address with us. Please use another way to sign in.',
  cancelled: 'Sign-in was cancelled.',
  failed: 'Sign-in did not complete. Please try again or use another way to sign in.',
  unavailable: 'That sign-in option is not available right now. Please use another way.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    expired?: string;
    signedout?: string;
    next?: string;
    sso?: string;
    setup?: string;
  }>;
}) {
  const params = await searchParams;
  const existing = await getClient().catch(() => null);
  if (existing) redirect('/');

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col">
        <ClientHeader />
        <LoginPhoto className="h-40 sm:h-56 lg:hidden" />
        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-8 lg:flex lg:flex-col lg:justify-center lg:pt-0">
          <h1 className="font-serif text-2xl font-semibold text-brand-900">
            Sign in to send your documents
          </h1>
          <p className="mt-2 text-neutral-700">
            Choose how you sign in. If your email is a Google or Microsoft account, use that button.
          </p>
          <div className="mt-4 space-y-3">
            {params.expired ? (
              <Alert tone="warning">
                For your security you were signed out. Please sign in again.
              </Alert>
            ) : null}
            {params.signedout ? <Alert tone="success">You are signed out.</Alert> : null}
            {params.sso && SSO_MESSAGES[params.sso] ? (
              <Alert tone={params.sso === 'cancelled' ? 'neutral' : 'error'}>
                {SSO_MESSAGES[params.sso]}
              </Alert>
            ) : null}
          </div>
          <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <ClientSignIn
              providers={clientSsoProviders()}
              next={safeNextPath(params.next ?? null)}
              startWithCode={params.setup === '1'}
            />
          </div>
        </main>
        <ClientFooter />
      </div>
      <LoginPhoto className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh" />
    </div>
  );
}

const LOGIN_PHOTO = process.env.NEXT_PUBLIC_LOGIN_PHOTO ?? '';

/** The horse-in-the-field photo; a quiet brand panel until the photo file is added. */
function LoginPhoto({ className }: { className: string }) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-brand-100 via-brand-50 to-brand-200 ${className}`}
    >
      {LOGIN_PHOTO ? (
        // A plain <img>: next/image "fill" sets inline styles, which the CSP blocks.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={LOGIN_PHOTO}
          alt=""
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-[50%_62%]"
        />
      ) : (
        <div className="flex h-full items-center justify-center" aria-hidden="true">
          <NestMark className="size-24 opacity-70 lg:size-40" />
        </div>
      )}
    </div>
  );
}
