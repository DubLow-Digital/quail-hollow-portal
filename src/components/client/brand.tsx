import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui';

export const FIRM_LEGAL_NAME = 'Quail Hollow Accounting Services LLC';
export const OFFICE_PHONE = '352-723-5062';
export const OFFICE_PHONE_HREF = 'tel:+13527235062';

const LOGO_SRC = process.env.NEXT_PUBLIC_BRAND_LOGO ?? '';

/** Simplified nest-and-eggs mark drawn from the Quail Hollow logo. */
export function NestMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="31" fill="#efe9df" />
      <path
        d="M14 22c4-6 9-9 15-10"
        stroke="#8a6f4f"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="19" cy="17" rx="3.4" ry="1.6" transform="rotate(-35 19 17)" fill="#8ea489" />
      <ellipse cx="25" cy="13.5" rx="3.2" ry="1.5" transform="rotate(-15 25 13.5)" fill="#a5b8a1" />
      <ellipse cx="15.5" cy="24" rx="3" ry="1.4" transform="rotate(-70 15.5 24)" fill="#a5b8a1" />
      <ellipse cx="25" cy="34" rx="6.4" ry="8" transform="rotate(-12 25 34)" fill="#a9bca9" />
      <ellipse cx="32.5" cy="30" rx="6.2" ry="7.8" fill="#e6d4ae" />
      <ellipse
        cx="39.5"
        cy="35"
        rx="6.4"
        ry="8"
        transform="rotate(12 39.5 35)"
        fill="#f7f3ec"
        stroke="#d9cbb3"
        strokeWidth="0.6"
      />
      <path d="M12 37c6 11 34 11 40 0c-2 9-9 14-20 14S14 46 12 37z" fill="#b39066" />
      <path
        d="M13 38c8 6 30 6 38 0M15 42c8 5 26 5 34 0M18 46c7 3 21 3 28 0"
        stroke="#8a6b45"
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Text wordmark matching the logo: "QUAIL HOLLOW", a rule with a dot, then the legal name. */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const top = { sm: 'text-base', md: 'text-lg sm:text-xl', lg: 'text-2xl sm:text-3xl' }[size];
  const bottom = { sm: 'text-[0.5rem]', md: 'text-[0.55rem] sm:text-[0.6rem]', lg: 'text-xs' }[
    size
  ];
  return (
    <span className="inline-flex flex-col items-center font-display leading-none text-brand-800">
      <span className={cx('font-semibold tracking-[0.08em] uppercase', top)}>Quail Hollow</span>
      <span aria-hidden="true" className="my-1 flex w-full items-center gap-1.5">
        <span className="h-px flex-1 bg-accent-400" />
        <span className="size-1 rounded-full bg-brand-800" />
        <span className="h-px flex-1 bg-accent-400" />
      </span>
      <span className={cx('font-medium tracking-[0.2em] uppercase', bottom)}>
        Accounting Services LLC
      </span>
    </span>
  );
}

/** The real logo when provided in public/brand, otherwise the drawn mark and wordmark. */
export function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  if (LOGO_SRC) {
    const height = { sm: 'h-10', md: 'h-12 sm:h-14', lg: 'h-16 sm:h-20' }[size];
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={LOGO_SRC} alt={FIRM_LEGAL_NAME} className={cx(height, 'w-auto')} />;
  }
  const mark = { sm: 'size-9', md: 'size-11 sm:size-12', lg: 'size-16' }[size];
  return (
    <span className="inline-flex items-center gap-3" role="img" aria-label={FIRM_LEGAL_NAME}>
      <NestMark className={mark} />
      <Wordmark size={size} />
    </span>
  );
}

export function ClientHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-accent-400/40 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/">
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
