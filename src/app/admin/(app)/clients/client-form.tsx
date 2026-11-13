'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/actions';
import type { EntityType } from '@/lib/db/types';
import { ENTITY_TYPES } from '@/lib/status';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ActionMessage } from '@/components/action-forms';

interface ClientValues {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  entity_types?: EntityType[];
}

export function ClientForm({
  action,
  values = {},
  submitLabel,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  values?: ClientValues;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const errors = state.fieldErrors ?? {};
  const entityTypes = values.entity_types ?? ['individual'];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {values.id ? <input type="hidden" name="client_id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="first_name" error={errors.first_name}>
          <Input
            id="first_name"
            name="first_name"
            defaultValue={values.first_name}
            autoComplete="off"
            required
            maxLength={100}
          />
        </Field>
        <Field label="Last name" htmlFor="last_name" error={errors.last_name}>
          <Input
            id="last_name"
            name="last_name"
            defaultValue={values.last_name}
            autoComplete="off"
            required
            maxLength={100}
          />
        </Field>
        <Field
          label="Email"
          htmlFor="email"
          error={errors.email}
          hint="The client signs in with a code sent to this address."
        >
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={values.email}
            autoComplete="off"
            required
            maxLength={254}
          />
        </Field>
        <Field label="Phone (optional)" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={values.phone ?? ''}
            autoComplete="off"
            maxLength={30}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-neutral-800">Entity types</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {ENTITY_TYPES.map((t) => (
            <label
              key={t.value}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-neutral-200"
            >
              <input
                type="checkbox"
                name="entity_types"
                value={t.value}
                defaultChecked={entityTypes.includes(t.value)}
                className="size-4 accent-brand-700"
              />
              <span className="text-sm">{t.label}</span>
            </label>
          ))}
        </div>
        {errors.entity_types ? (
          <p className="mt-1 text-sm text-red-700" role="alert">
            {errors.entity_types}
          </p>
        ) : null}
      </fieldset>
      <ActionMessage state={state} />
      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
