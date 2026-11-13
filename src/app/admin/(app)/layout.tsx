import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/admin';
import { AdminNav } from './admin-nav';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-brand-900 bg-brand-800 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="font-display text-base font-semibold tracking-[0.08em] uppercase">
              Quail Hollow
            </p>
            <p className="text-xs text-brand-100">Client portal admin</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-brand-100 sm:inline">{admin.name}</span>
            <form action="/api/auth/admin/signout" method="post">
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-sm text-white ring-1 ring-white/30 hover:bg-white/10"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
