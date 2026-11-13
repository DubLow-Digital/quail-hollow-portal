'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/actions';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ActionMessage } from '@/components/action-forms';

export function BundleForm({
  action,
  types,
  values = {},
  submitLabel,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  types: { id: string; name: string; active: boolean }[];
  values?: { id?: string; name?: string; description?: string; document_type_ids?: string[] };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const errors = state.fieldErrors ?? {};
  const selected = new Set(values.document_type_ids ?? []);
  const prefix = values.id ?? 'new';

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bundle name" htmlFor={`${prefix}-name`} error={errors.name}>
          <Input id={`${prefix}-name`} name="name" defaultValue={values.name} maxLength={120} />
        </Field>
        <Field label="Description" htmlFor={`${prefix}-description`} error={errors.description}>
          <Input
            id={`${prefix}-description`}
            name="description"
            defaultValue={values.description}
            maxLength={500}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-neutral-800">Document types</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {types.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="document_type_ids"
                value={t.id}
                defaultChecked={selected.has(t.id)}
                className="size-4 accent-brand-700"
              />
              {t.name}
              {!t.active ? <span className="text-xs text-neutral-500">(inactive)</span> : null}
            </label>
          ))}
        </div>
        {errors.document_type_ids ? (
          <p className="mt-1 text-sm text-red-700">{errors.document_type_ids}</p>
        ) : null}
      </fieldset>
      <ActionMessage state={state} />
      <SubmitButton size="sm" pendingLabel="Saving…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
