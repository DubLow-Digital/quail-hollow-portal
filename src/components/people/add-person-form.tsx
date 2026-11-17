'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { ActionState } from '@/lib/actions';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ActionMessage } from '@/components/action-forms';

/** Adds an approved user (someone else who may sign in for this client). */
export function AddPersonForm({
  action,
  hidden = {},
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const errors = state.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3" noValidate>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name" htmlFor="person_first_name" error={errors.first_name}>
          <Input id="person_first_name" name="first_name" autoComplete="off" maxLength={100} />
        </Field>
        <Field label="Last name" htmlFor="person_last_name" error={errors.last_name}>
          <Input id="person_last_name" name="last_name" autoComplete="off" maxLength={100} />
        </Field>
      </div>
      <Field label="Their email" htmlFor="person_email" error={errors.email}>
        <Input
          id="person_email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="send_invite" value="1" defaultChecked className="size-4" />
        Email them an invite now
      </label>
      <SubmitButton size="sm" pendingLabel="Adding…">
        Add person
      </SubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}
