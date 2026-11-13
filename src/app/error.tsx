'use client';

import Link from 'next/link';
import { buttonClass } from '@/components/ui';

/** Friendly fallback for unexpected errors. Error details stay on the server. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-md px-4 pt-16 text-center">
      <h1 className="font-serif text-2xl font-semibold text-brand-900">Something went wrong</h1>
      <p className="mt-2 text-neutral-700">
        Please try again. If it keeps happening, call our office at{' '}
        <a href="tel:+13527235062" className="font-medium text-brand-700 underline">
          352-723-5062
        </a>
        .
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button type="button" onClick={reset} className={buttonClass('primary', 'lg')}>
          Try again
        </button>
        <Link href="/" className={buttonClass('secondary', 'lg')}>
          Go to my documents
        </Link>
      </div>
    </main>
  );
}
