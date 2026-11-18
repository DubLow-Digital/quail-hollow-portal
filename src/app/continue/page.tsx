import { ClientFooter, ClientHeader } from '@/components/client/brand';
import { ContinueSignIn } from './continue-sign-in';

export const metadata = { title: 'Continue on your phone' };

/** Where a "continue on your phone" QR code lands. Works without a session. */
export default function ContinuePage() {
  return (
    <div className="min-h-dvh">
      <ClientHeader />
      <main className="mx-auto max-w-md space-y-4 px-4 pt-8">
        <h1 className="font-serif text-2xl font-semibold text-brand-900">Continue on your phone</h1>
        <ContinueSignIn />
      </main>
      <ClientFooter />
    </div>
  );
}
