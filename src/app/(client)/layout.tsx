import Link from 'next/link';
import { requireClient } from '@/lib/auth/client';
import { ClientFooter, ClientHeader } from '@/components/client/brand';
import { IdleLogout } from '@/components/client/idle-logout';

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClient();
  return (
    <div className="min-h-dvh">
      <ClientHeader
        right={
          <div className="flex items-center gap-1">
            {ctx.user.role === 'primary' ? (
              <Link
                href="/people"
                prefetch={false}
                className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-brand-800 hover:bg-brand-50"
              >
                People
              </Link>
            ) : null}
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="min-h-11 rounded-xl px-3 text-sm font-medium text-brand-800 hover:bg-brand-50"
              >
                Sign out
              </button>
            </form>
          </div>
        }
      />
      <main className="mx-auto max-w-2xl px-4 pt-6">{children}</main>
      <ClientFooter />
      <IdleLogout />
    </div>
  );
}
