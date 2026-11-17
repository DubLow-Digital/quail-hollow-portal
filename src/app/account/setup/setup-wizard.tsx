'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { PasskeyMark } from '@/components/client/sso-icons';
import {
  createPasskeyCredential,
  getPasskeyCredential,
  passkeyCancelled,
  passkeysSupported,
} from '@/lib/auth/webauthn-browser';
import { PASSWORD_MIN } from '@/lib/auth/password-policy';

/**
 * first:        nothing set up yet; choose a passkey, or a password plus authenticator app.
 * recover:      something is set up; prove it with the authenticator (or passkey) first.
 * new_password: authenticator just confirmed; choose a new password.
 * manage:       fully signed in; add a passkey, an authenticator, or change the password.
 */
export type SetupMode = 'first' | 'recover' | 'new_password' | 'manage';
type Step = 'choose' | 'password' | 'totp_enroll' | 'totp_confirm' | 'done';

const noSubscribe = () => () => {};
const OFFICE = '352-723-5062';

async function postJson(path: string, body: unknown = {}) {
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
  window.location.assign(path);
}

export function SetupWizard({
  mode,
  firstName,
  hasPassword,
  totpFactorId,
  passkeyCount,
}: {
  mode: SetupMode;
  firstName: string;
  hasPassword: boolean;
  totpFactorId: string | null;
  passkeyCount: number;
}) {
  const initial: Step =
    mode === 'new_password'
      ? 'password'
      : mode === 'recover' && totpFactorId
        ? 'totp_confirm'
        : 'choose';
  const [step, setStep] = useState<Step>(initial);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canPasskey = useSyncExternalStore(noSubscribe, passkeysSupported, () => false);
  const managing = mode === 'manage';

  function fail(status: number, fallback: string, message?: unknown) {
    if (status === 429)
      return setError('Too many attempts. Please wait a few minutes and try again.');
    if (status === 401) return go('/login?expired=1');
    setError(typeof message === 'string' ? message : fallback);
  }

  async function addPasskey() {
    setError(null);
    setBusy(true);
    try {
      const start = await postJson('/api/auth/client/setup/passkey/options');
      if (start.status !== 200)
        return fail(
          start.status,
          'Passkeys are not available right now. Please use a password instead.',
        );
      const credential = await createPasskeyCredential(
        start.body.options as Record<string, unknown>,
      );
      const saved = await postJson('/api/auth/client/setup/passkey/verify', {
        challengeId: start.body.challengeId,
        credential,
      });
      if (saved.status !== 200)
        return fail(saved.status, 'The passkey was not saved. Please try again.');
      if (saved.body.redirect) return go(saved.body.redirect);
      setNotice('Passkey added. Next time, choose "Sign in with a passkey".');
      setStep('done');
    } catch (err) {
      setError(passkeyCancelled(err) ? null : 'The passkey was not saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setError(null);
    setBusy(true);
    try {
      const start = await postJson('/api/auth/client/passkey/options');
      if (start.status !== 200)
        return fail(start.status, 'Passkey sign-in is not available right now.');
      const credential = await getPasskeyCredential(start.body.options as Record<string, unknown>);
      const done = await postJson('/api/auth/client/passkey/verify', {
        challengeId: start.body.challengeId,
        credential,
      });
      if (done.status === 200) return go(done.body.redirect);
      setError('We did not recognize that passkey.');
    } catch (err) {
      setError(passkeyCancelled(err) ? null : 'The passkey did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      const r = await postJson('/api/auth/client/setup/password', { password });
      if (r.status !== 200)
        return fail(r.status, 'The password was not saved. Please try again.', r.body.message);
      setPassword('');
      setConfirm('');
      if (r.body.redirect) return go(r.body.redirect);
      if (managing && (totpFactorId || r.body.done !== true)) {
        setNotice('Password saved.');
        return setStep('done');
      }
      if (managing && !totpFactorId) {
        setNotice('Password saved. Now add an authenticator app: it is needed with a password.');
      }
      await startTotp();
    } catch {
      setError('We could not reach the portal. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function startTotp() {
    setError(null);
    const r = await postJson('/api/auth/client/setup/totp/enroll');
    if (r.status !== 200)
      return fail(r.status, 'We could not start the authenticator setup. Please try again.');
    setEnroll({
      factorId: String(r.body.factorId),
      qr: String(r.body.qr),
      secret: String(r.body.secret),
    });
    setCode('');
    setStep('totp_enroll');
  }

  async function verifyTotp(e: React.FormEvent, factorId: string, finish: boolean) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code))
      return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    try {
      const r = await postJson('/api/auth/client/setup/totp/verify', { factorId, code, finish });
      if (r.status !== 200)
        return fail(
          r.status,
          'That code is not right. Codes change every 30 seconds; try the current one.',
        );
      setCode('');
      if (r.body.redirect) return go(r.body.redirect);
      if (step === 'totp_confirm') {
        // Recovery: proven with the authenticator; now choose a new password.
        return setStep('password');
      }
      setNotice('Authenticator app added.');
      setStep('done');
    } catch {
      setError('We could not reach the portal. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'manage'
      ? 'Your sign-in options'
      : mode === 'first'
        ? `Welcome${firstName ? `, ${firstName}` : ''}. Set up how you sign in.`
        : 'Confirm it is you';

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-semibold text-brand-900">{heading}</h1>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {step === 'choose' && mode === 'first' ? (
        <div className="space-y-4">
          <p className="text-neutral-700">
            Choose one. Either way, only you can sign in, even if someone knows your email.
          </p>
          {canPasskey ? (
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-lg font-semibold text-brand-900">Use a passkey (easiest)</h2>
              <p className="mt-1 text-sm text-neutral-700">
                Sign in with Face ID, your fingerprint, or your phone. Nothing to remember.
              </p>
              <Button
                type="button"
                size="lg"
                className="mt-4 w-full gap-3"
                onClick={() => void addPasskey()}
                disabled={busy}
              >
                <PasskeyMark />
                {busy ? 'Waiting for your device…' : 'Create a passkey'}
              </Button>
            </section>
          ) : null}
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="text-lg font-semibold text-brand-900">
              Use a password and an authenticator app
            </h2>
            <p className="mt-1 text-sm text-neutral-700">
              Choose a password, then link a free authenticator app (such as Google Authenticator or
              Microsoft Authenticator) that shows a new 6-digit code every 30 seconds.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="mt-4 w-full"
              onClick={() => {
                setError(null);
                setStep('password');
              }}
              disabled={busy}
            >
              Use a password
            </Button>
          </section>
        </div>
      ) : null}

      {step === 'choose' && mode === 'recover' ? (
        <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          {passkeyCount > 0 && canPasskey ? (
            <>
              <p className="text-neutral-700">You set up a passkey. Use it to sign in.</p>
              <Button
                type="button"
                size="lg"
                className="w-full gap-3"
                onClick={() => void signInWithPasskey()}
                disabled={busy}
              >
                <PasskeyMark />
                Sign in with your passkey
              </Button>
            </>
          ) : null}
          <p className="text-sm text-neutral-700">
            Lost the device you set up? Call our office at{' '}
            <a
              href={`tel:+1${OFFICE.replace(/-/g, '')}`}
              className="font-medium text-brand-700 underline"
            >
              {OFFICE}
            </a>{' '}
            and we will reset your sign-in.
          </p>
        </div>
      ) : null}

      {step === 'choose' && mode === 'manage' ? (
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="text-lg font-semibold text-brand-900">Passkeys</h2>
            <p className="mt-1 text-sm text-neutral-700">
              {passkeyCount > 0
                ? `You have ${passkeyCount} passkey${passkeyCount === 1 ? '' : 's'}. Add one for another device.`
                : 'Sign in with Face ID, your fingerprint or your phone.'}
            </p>
            {canPasskey ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-3 gap-3"
                onClick={() => void addPasskey()}
                disabled={busy}
              >
                <PasskeyMark />
                Add a passkey
              </Button>
            ) : (
              <p className="mt-3 text-sm text-neutral-600">This browser cannot create passkeys.</p>
            )}
          </section>
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="text-lg font-semibold text-brand-900">Password and authenticator app</h2>
            <p className="mt-1 text-sm text-neutral-700">
              {hasPassword
                ? totpFactorId
                  ? 'You sign in with a password and an authenticator code.'
                  : 'You have a password. Add an authenticator app to use it.'
                : 'Optional. Useful on devices without your passkey.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setStep('password');
                }}
                disabled={busy}
              >
                {hasPassword ? 'Change password' : 'Set a password'}
              </Button>
              {hasPassword && !totpFactorId ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void startTotp()}
                  disabled={busy}
                >
                  Add an authenticator app
                </Button>
              ) : null}
            </div>
          </section>
          <Link
            href="/"
            prefetch={false}
            className="inline-block font-medium text-brand-700 underline"
          >
            Back to my documents
          </Link>
        </div>
      ) : null}

      {step === 'password' ? (
        <form
          onSubmit={savePassword}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
          noValidate
        >
          <h2 className="text-lg font-semibold text-brand-900">
            {mode === 'first' ? 'Choose a password' : 'Choose a new password'}
          </h2>
          <p className="text-sm text-neutral-700">
            At least {PASSWORD_MIN} characters. A short phrase you will remember works well, for
            example three or four words.
          </p>
          <Field label="New password" htmlFor="new_password">
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
            />
          </Field>
          <Field label="Type it again" htmlFor="confirm_password">
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              maxLength={128}
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </Button>
        </form>
      ) : null}

      {step === 'totp_enroll' && enroll ? (
        <form
          onSubmit={(e) => void verifyTotp(e, enroll.factorId, !managing)}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
          noValidate
        >
          <h2 className="text-lg font-semibold text-brand-900">Link your authenticator app</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
            <li>Open your authenticator app and choose to add an account.</li>
            <li>Scan this code, or type the key below.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL from the server */}
          <img
            src={enroll.qr}
            alt="QR code for your authenticator app"
            className="mx-auto size-48 rounded-lg bg-white p-2 ring-1 ring-black/10"
          />
          <p className="text-center text-sm text-neutral-700">
            Key:{' '}
            <code data-testid="totp-secret" className="font-mono break-all">
              {enroll.secret}
            </code>
          </p>
          <Field label="Code from the app" htmlFor="totp_code">
            <Input
              id="totp_code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? 'Checking…' : managing ? 'Add authenticator' : 'Finish and sign in'}
          </Button>
        </form>
      ) : null}

      {step === 'totp_confirm' && totpFactorId ? (
        <form
          onSubmit={(e) => void verifyTotp(e, totpFactorId, false)}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"
          noValidate
        >
          <p className="text-neutral-700">
            Enter the code from your authenticator app. Then you can choose a new password.
          </p>
          <Field label="Authenticator code" htmlFor="confirm_code">
            <Input
              id="confirm_code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          </Field>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
          {passkeyCount > 0 && canPasskey ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full gap-3"
              onClick={() => void signInWithPasskey()}
              disabled={busy}
            >
              <PasskeyMark />
              Use my passkey instead
            </Button>
          ) : null}
          <p className="text-sm text-neutral-600">
            Lost your phone? Call our office at {OFFICE} and we will reset your sign-in.
          </p>
        </form>
      ) : null}

      {step === 'done' ? (
        <Link
          href="/"
          prefetch={false}
          className="inline-block font-medium text-brand-700 underline"
        >
          Back to my documents
        </Link>
      ) : null}

      {error && (step === 'choose' || step === 'done') ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
