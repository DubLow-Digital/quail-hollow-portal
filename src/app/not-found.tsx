import Link from 'next/link';
import { ClientFooter, ClientHeader } from '@/components/client/brand';
import { buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <ClientHeader />
      <main className="mx-auto max-w-md px-4 pt-10 text-center">
        <h1 className="font-serif text-2xl font-semibold text-brand-900">
          We could not find that page
        </h1>
        <p className="mt-2 text-neutral-700">
          The link may be old, or the item may have been removed. Your list of documents is on the
          home page.
        </p>
        <Link href="/" className={buttonClass('primary', 'lg', 'mt-6')}>
          Go to my documents
        </Link>
      </main>
      <ClientFooter />
    </div>
  );
}
