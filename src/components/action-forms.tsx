'use client';

import { useActionState, type ReactNode } from 'react';
import type { ActionState } from '@/lib/actions';
import { Alert } from './ui';
import { SubmitButton } from './submit-button';

type ServerAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Shows the message an action returned. */
export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>;
}

/**
 * A one-button form for simple actions (archive, create folder, resend invite...).
 * Hidden fields carry IDs; the server re-validates everything.
 */
export function ActionButtonForm({
  action,
  hidden,
  label,
  pendingLabel,
  variant = 'secondary',
  confirm,
  children,
}: {
  action: ServerAction;
  hidden: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  confirm?: string;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  return (
    <form
      action={formAction}
      className="space-y-2"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <SubmitButton variant={variant} size="sm" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}
