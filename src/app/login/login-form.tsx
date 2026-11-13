'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@/components/ui';

type Step = 'email' | 'code';

const RESEND_COOLDOWN_S = 60;

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      if (res.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
        return;
      }
      if (!res.ok) {
        setError('Please check the email address and try again.');
        return;
      }
      setStep('code');
      setCode('');
      setCooldown(RESEND_COOLDOWN_S);
      setInfo(`If ${value} is registered with us, a code is on its way. It expires in 10 minutes.`);
    } catch {
      setError('We could not reach the portal. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = code.replace(/\D/g, '');
    if (digits.length < 6) {
      setError('Enter the code from your email.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: digits, next: next ?? undefined }),
      });
      if (res.status === 429) {
        setError('Too many attempts. Please wait a few minutes, then request a new code.');
        return;
      }
      if (!res.ok) {
        setError('That code is not right or has expired. Check the email or request a new code.');
        return;
      }
      const body = (await res.json()) as { redirect?: string };
      router.replace(body.redirect ?? '/');
      router.refresh();
    } catch {
      setError('We could not reach the portal. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={requestCode} className="space-y-4" noValidate>
        <Field label="Email address" htmlFor="email">
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
          {busy ? 'Sending…' : 'Email me a code'}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="space-y-4" noValidate>
      {info ? <Alert tone="neutral">{info}</Alert> : null}
      <Field label="Enter your code" htmlFor="code">
        <Input
          ref={codeRef}
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="text-center font-mono text-2xl tracking-[0.4em]"
          aria-describedby="code-help"
        />
      </Field>
      <p id="code-help" className="text-sm text-neutral-600">
        Check your inbox (and spam folder) for an email from Quail Hollow Accounting.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {busy ? 'Checking…' : 'Sign in'}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="min-h-11 px-1 font-medium text-brand-700 underline disabled:text-neutral-400 disabled:no-underline"
          onClick={() => void requestCode()}
          disabled={busy || cooldown > 0}
        >
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        </button>
        <button
          type="button"
          className="min-h-11 px-1 font-medium text-brand-700 underline"
          onClick={() => {
            setStep('email');
            setError(null);
            setInfo(null);
          }}
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
