'use client';

import { useState, useSyncExternalStore } from 'react';
import { Alert, Button, Field, Input, buttonClass } from '@/components/ui';
import { GoogleMark, MicrosoftMark, PasskeyMark } from '@/components/client/sso-icons';
import {
  passkeyCancelled,
  passkeysSupported,
  getPasskeyCredential,
} from '@/lib/auth/webauthn-browser';
import { LoginForm } from './login-form';

type Mode = 'choose' | 'totp' | 'code';

const noSubscribe = () => () => {};

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // empty body
  }
  return { status: res.status, body: json };
}

function go(target: unknown) {
  const path =
    typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') ? target : '/';
  // A full page load: the browser may hold a cached redirect to sign-in for the target.
  window.location.assign(path);
}

/**
 * Client sign-in: Google, Microsoft, a passkey, or email + password followed by an
 * authenticator code. An emailed code is only for first-time setup and recovery.
 */
export function ClientSignIn({
  providers,
  next,
  startWithCode = false,
}: {
  providers: ('google' | 'microsoft')[];
  next: string | null;
  startWithCode?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(startWithCode ? 'code' : 'choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Passkeys depend on the browser, so the button appears after hydration.
  const canPasskey = useSyncExternalStore(noSubscribe, passkeysSupported, () => false);

  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : '';

  async function signInWithPasskey() {
    setError(null);
    setBusy(true);
    try {
      const start = await postJson('/api/auth/client/passkey/options', {});
      if (start.status !== 200) {
        setError(
          start.status === 429
            ? 'Too many attempts. Please wait a few minutes.'
            : 'Passkey sign-in is not available right now.',
        );
        return;
      }
      const credential = await getPasskeyCredential(start.body.options as Record<string, unknown>);
      const done = await postJson('/api/auth/client/passkey/verify', {
        challengeId: start.body.challengeId,
        credential,
        next: next ?? undefined,
      });
      if (done.status === 200) return go(done.body.redirect);
      setError(
        'We did not recognize that passkey. Try another way to sign in, or choose "First time here?" below.',
      );
    } catch (err) {
      setError(passkeyCancelled(err) ? null : 'The passkey did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setBusy(true);
    try {
      const r = await postJson('/api/auth/client/password', { email: email.trim(), password });
      if (r.status === 429)
        return setError('Too many attempts. Please wait a few minutes and try again.');
      if (r.status === 409) {
        // Password set, but setup was never finished: continue with an emailed code.
        setPassword('');
        setMode('code');
        return;
      }
      if (r.status !== 200)
        return setError(
          'That email and password do not match. Check them, or choose "Forgot your password?" below.',
        );
      if (r.body.redirect) return go(r.body.redirect);
      setFactorId(String(r.body.factorId));
      setPassword('');
      setMode('totp');
    } catch {
      setError('We could not reach the portal. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code))
      return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    try {
      const r = await postJson('/api/auth/client/mfa/totp', {
        factorId,
        code,
        next: next ?? undefined,
      });
      if (r.status === 200) return go(r.body.redirect);
      if (r.status === 429)
        return setError('Too many attempts. Please wait a few minutes and try again.');
      if (r.status === 401) {
        setMode('choose');
        return setError('That took too long. Please sign in again.');
      }
      setError('That code is not right. Codes change every 30 seconds; try the current one.');
    } catch {
      setError('We could not reach the portal. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'totp') {
    return (
      <form onSubmit={verifyTotp} className="space-y-4" noValidate>
        <p className="text-neutral-700">
          Open your authenticator app and enter the 6-digit code for Quail Hollow Accounting.
        </p>
        <Field label="Authenticator code" htmlFor="totp">
          <Input
            id="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="text-center font-mono text-2xl tracking-[0.4em]"
            autoFocus
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        <p className="text-sm text-neutral-600">
          Lost your phone? Call our office and we will reset your sign-in.
        </p>
      </form>
    );
  }

  if (mode === 'code') {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-brand-900">
          First time here, or forgot your password?
        </h2>
        <p className="text-sm text-neutral-700">
          Enter the email address we have for you. We will email you a code, then you can set up a
          passkey (Face ID, fingerprint or your phone) or a password with an authenticator app.
        </p>
        <LoginForm next={next} verifyLabel="Continue" />
        <button
          type="button"
          className="min-h-11 px-1 text-sm font-medium text-brand-700 underline"
          onClick={() => setMode('choose')}
        >
          Back to sign-in options
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {providers.includes('google') ? (
          <a
            href={`/api/auth/client/sso/google${nextQuery}`}
            className={buttonClass('secondary', 'lg', 'w-full gap-3')}
          >
            <GoogleMark />
            Continue with Google
          </a>
        ) : null}
        {providers.includes('microsoft') ? (
          <a
            href={`/api/auth/client/sso/microsoft${nextQuery}`}
            className={buttonClass('secondary', 'lg', 'w-full gap-3')}
          >
            <MicrosoftMark />
            Continue with Microsoft
          </a>
        ) : null}
        {canPasskey ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full gap-3"
            onClick={() => void signInWithPasskey()}
            disabled={busy}
          >
            <PasskeyMark />
            Sign in with a passkey
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-sm text-neutral-500" aria-hidden="true">
        <span className="h-px flex-1 bg-neutral-200" />
        or use your email and password
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <form onSubmit={signInWithPassword} className="space-y-4" noValidate>
        <Field label="Email address" htmlFor="email">
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={128}
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
      </form>

      <button
        type="button"
        className="min-h-11 w-full rounded-xl px-3 text-center font-medium text-brand-700 underline"
        onClick={() => {
          setError(null);
          setMode('code');
        }}
      >
        First time here? Forgot your password?
      </button>
    </div>
  );
}
