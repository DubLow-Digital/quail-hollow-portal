import Link from 'next/link';
import type { ReactNode } from 'react';

export const OFFICE_PHONE = '352-723-5062';
export const OFFICE_PHONE_HREF = 'tel:+13527235062';

export function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-xl bg-brand-700 font-serif text-lg font-bold text-canvas"
    >
      QH
    </span>
  );
}

export function ClientHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark />
          <span className="leading-tight">
            <span className="block text-base font-semibold text-brand-900">Quail Hollow</span>
            <span className="block text-xs text-neutral-600">Accounting Services</span>
          </span>
        </Link>
        {right}
      </div>
    </header>
  );
}

export function ClientFooter() {
  return (
    <footer className="mx-auto max-w-2xl px-4 pt-8 pb-10 text-sm text-neutral-600">
      <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
        <p className="font-medium text-neutral-800">Need help?</p>
        <p className="mt-1">
          Call our office at{' '}
          <a href={OFFICE_PHONE_HREF} className="font-medium text-brand-700 underline">
            {OFFICE_PHONE}
          </a>
          . We are happy to walk you through it.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Your documents are sent over an encrypted connection straight to your secure client file.
          Please never email tax documents.
        </p>
      </div>
    </footer>
  );
}
