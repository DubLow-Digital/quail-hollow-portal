'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui';
import { OFFICE_PHONE, OFFICE_PHONE_HREF } from '@/components/client/brand';

type State = 'working' | 'expired' | 'used' | 'closed' | 'invalid' | 'busy' | 'offline';

const MESSAGES: Record<Exclude<State, 'working'>, { title: string; body: string }> = {
  expired: {
    title: 'This code has expired',
    body: 'Codes work for 5 minutes. On your computer, choose “Show a new code” and scan it again.',
  },
  used: {
    title: 'This code was already used',
    body: 'Each code works once. On your computer, choose “Show a new code” and scan it again.',
  },
  closed: {
    title: 'This item is already complete',
    body: 'We have everything we need for it. Thank you!',
  },
  invalid: {
    title: 'This link did not work',
    body: 'Scan the code on your computer again, or sign in on this phone.',
  },
  busy: {
    title: 'Please wait a moment',
    body: 'There were too many tries in a short time. Please try again in a few minutes.',
  },
  offline: {
    title: 'You seem to be offline',
    body: 'Check your connection, then scan the code on your computer again.',
  },
};

/**
 * Reads the one-time code from the link's fragment (which is never sent to a server), removes
 * it from the address bar and history, exchanges it for a sign-in limited to one item, and
 * opens that item.
 */
export function ContinueSignIn() {
  const [state, setState] = useState<State>('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/continue');
    void (async () => {
      if (!token) return setState('invalid');
      try {
        const res = await fetch('/api/auth/client/handoff/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          credentials: 'same-origin',
        });
        const data = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
        if (res.ok && data.next?.startsWith('/request/')) {
          window.location.replace(data.next);
          return;
        }
        setState(
          data.error === 'expired'
            ? 'expired'
            : data.error === 'used'
              ? 'used'
              : data.error === 'request_closed'
                ? 'closed'
                : data.error === 'rate_limited'
                  ? 'busy'
                  : 'invalid',
        );
      } catch {
        setState('offline');
      }
    })();
  }, []);

  if (state === 'working') {
    return (
      <p className="text-lg text-brand-900" role="status">
        Signing you in on this phone…
      </p>
    );
  }
  const m = MESSAGES[state];
  return (
    <div className="space-y-4">
      <Alert tone={state === 'closed' ? 'success' : 'warning'} title={m.title}>
        {m.body}
      </Alert>
      <p className="text-sm text-neutral-700">
        <Link href="/login" className="font-medium text-brand-700 underline">
          Sign in on this phone
        </Link>{' '}
        or call{' '}
        <a href={OFFICE_PHONE_HREF} className="font-medium text-brand-700 underline">
          {OFFICE_PHONE}
        </a>
        .
      </p>
    </div>
  );
}
