import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSetupContext } from '@/lib/auth/setup-context';
import { ClientFooter, ClientHeader } from '@/components/client/brand';
import { SetupWizard, type SetupMode } from './setup-wizard';

export const metadata: Metadata = { title: 'Sign-in setup' };

/**
 * Reached after an emailed code (first-time setup or recovery), or by a fully signed-in
 * person managing their sign-in options.
 */
export default async function SetupPage() {
  const ctx = await getSetupContext();
  if (!ctx) redirect('/login');

  const mode: SetupMode =
    ctx.level === 'full'
      ? 'manage'
      : !ctx.hasExisting
        ? 'first'
        : ctx.canEnroll
          ? 'new_password'
          : 'recover';

  return (
    <div className="min-h-dvh">
      <ClientHeader
        right={
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="min-h-11 rounded-xl px-3 text-sm font-medium text-brand-800 hover:bg-brand-50"
            >
              Sign out
            </button>
          </form>
        }
      />
      <main className="mx-auto max-w-md px-4 pt-8">
        <SetupWizard
          mode={mode}
          firstName={ctx.user.first_name}
          hasPassword={Boolean(ctx.user.password_set_at)}
          totpFactorId={ctx.setup.totpFactorIds[0] ?? null}
          passkeyCount={ctx.setup.passkeyCount}
        />
      </main>
      <ClientFooter />
    </div>
  );
}
