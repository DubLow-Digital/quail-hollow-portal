'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { encode } from 'uqr';
import { Button } from '@/components/ui';

/**
 * "Use your phone instead", on a computer: shows a QR code that opens this request on the
 * client's phone, already signed in, so they can take a picture of the document there. The
 * code works once and expires after a few minutes. While it is up, this page checks every few
 * seconds and says so when the file arrives from the phone.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'showing'; url: string; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

const POLL_MS = 5000;
/** Keep watching for the phone's file this long after the code was made (the phone session). */
const WATCH_MS = 30 * 60 * 1000;

function QrSvg({ value }: { value: string }) {
  const path = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { d, size: data.length };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label="QR code to open this item on your phone"
      className="size-56 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export function PhoneHandoff({ requestId, sentCount }: { requestId: string; sentCount: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const [received, setReceived] = useState(false);
  const watchUntil = useRef(0);
  const startCount = useRef(sentCount);

  // A file that arrives while we are watching (sent from the phone) ends the wait.
  useEffect(() => {
    if (watchUntil.current && sentCount > startCount.current) {
      watchUntil.current = 0;
      queueMicrotask(() => setReceived(true));
    }
  }, [sentCount]);

  // While watching: re-read the page every few seconds, and tick the expiry countdown.
  const watching = phase.kind === 'showing' || phase.kind === 'expired';
  useEffect(() => {
    if (!watching || received) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t > watchUntil.current) return;
      if (document.visibilityState === 'visible') router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [watching, received, router]);

  async function makeCode() {
    setPhase({ kind: 'loading' });
    setReceived(false);
    try {
      const res = await fetch('/api/auth/client/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        expiresAt?: number;
        error?: string;
      };
      if (!res.ok || !data.url || !data.expiresAt) {
        setPhase({
          kind: 'error',
          message:
            data.error === 'rate_limited'
              ? 'Too many codes in a short time. Please wait a few minutes and try again.'
              : 'We could not make a code right now. Please try again.',
        });
        return;
      }
      startCount.current = sentCount;
      watchUntil.current = Date.now() + WATCH_MS;
      setNow(Date.now());
      setPhase({ kind: 'showing', url: data.url, expiresAt: data.expiresAt });
    } catch {
      setPhase({ kind: 'error', message: 'You seem to be offline. Please try again.' });
    }
  }

  const secondsLeft = phase.kind === 'showing' ? Math.ceil((phase.expiresAt - now) / 1000) : 0;
  const expired = phase.kind === 'expired' || (phase.kind === 'showing' && secondsLeft <= 0);

  if (received) {
    return (
      <div
        role="status"
        className="hidden rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-200 lg:block"
      >
        <p className="text-lg font-semibold text-emerald-900">
          Received from your phone. Thank you!
        </p>
        <p className="mt-1 text-emerald-900/80">It is listed below under “You have sent”.</p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="phone-handoff-heading"
      className="hidden space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/5 lg:block"
      data-testid="phone-handoff"
    >
      <div>
        <h2 id="phone-handoff-heading" className="text-lg font-semibold text-brand-900">
          Use your phone instead
        </h2>
        <p className="text-sm text-neutral-600">
          Easier to take a picture with your phone? Scan a code and this item opens there, already
          signed in.
        </p>
      </div>

      {phase.kind === 'showing' && !expired ? (
        <div className="flex items-start gap-5" data-handoff-url={phase.url}>
          <QrSvg value={phase.url} />
          <div className="space-y-2 text-sm text-neutral-700">
            <p className="font-medium text-brand-900">Point your phone’s camera at the code.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Open the camera on your phone and tap the link that appears.</li>
              <li>Take the picture or scan the document there and tap Send.</li>
              <li>This page shows it here when it arrives.</li>
            </ol>
            <p className="text-neutral-500">
              The code works once and expires in{' '}
              {secondsLeft >= 60
                ? `${Math.ceil(secondsLeft / 60)} minutes`
                : `${secondsLeft} seconds`}
              . Your phone can send documents for this item only.
            </p>
          </div>
        </div>
      ) : expired ? (
        <div className="space-y-2">
          <p className="text-sm text-neutral-700">
            That code has expired. If you already opened it on your phone, you can keep going there.
          </p>
          <Button type="button" variant="secondary" onClick={() => void makeCode()}>
            Show a new code
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {phase.kind === 'error' ? (
            <p role="alert" className="text-sm text-red-700">
              {phase.message}
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void makeCode()}
            disabled={phase.kind === 'loading'}
          >
            {phase.kind === 'loading' ? 'Making a code…' : 'Show a code for my phone'}
          </Button>
        </div>
      )}
    </section>
  );
}
