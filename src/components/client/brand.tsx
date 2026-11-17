import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

export const FIRM_LEGAL_NAME = 'Quail Hollow Accounting Services LLC';
export const OFFICE_PHONE = '352-723-5062';
export const OFFICE_PHONE_HREF = 'tel:+13527235062';

/** Quail Hollow's real logo files (public/brand). Never redraw or substitute them. */
export const LOGO_HORIZONTAL = '/brand/logo-horizontal.png';
export const LOGO_NEST = '/brand/nest.png';

/** The nest-and-eggs circle from the real logo. */
export function NestMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_NEST} alt="" aria-hidden="true" className={className} />;
}

/** The real horizontal Quail Hollow logo. */
export function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const height = { sm: 'h-14', md: 'h-16 sm:h-20', lg: 'h-20 sm:h-24' }[size];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_HORIZONTAL} alt={FIRM_LEGAL_NAME} className={cx(height, 'w-auto')} />;
}

export function ClientHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-accent-400/40 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" prefetch={false}>
          <BrandLogo />
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
          Your documents travel over an encrypted connection straight to your secure client file.
          Please never email tax documents.
        </p>
      </div>
      <p className="mt-4 text-center font-display text-[0.65rem] tracking-[0.2em] text-brand-600 uppercase">
        {FIRM_LEGAL_NAME} · Ocala, Florida
      </p>
    </footer>
  );
}
