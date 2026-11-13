'use client';

import { useActionState, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ActionMessage } from '@/components/action-forms';

export interface AssignableType {
  id: string;
  name: string;
  requiresYear: boolean;
  needsBusiness: boolean;
}

export interface AssignableBundle {
  id: string;
  name: string;
  typeIds: string[];
}

export function AssignRequestsForm({
  clientId,
  types,
  bundles,
  defaultTaxYear,
  action,
}: {
  clientId: string;
  types: AssignableType[];
  bundles: AssignableBundle[];
  defaultTaxYear: number;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const errors = state.fieldErrors ?? {};
  const [bundleId, setBundleId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const effective = useMemo(() => {
    const ids = new Set(picked);
    for (const id of bundles.find((b) => b.id === bundleId)?.typeIds ?? []) ids.add(id);
    return types.filter((t) => ids.has(t.id));
  }, [picked, bundleId, bundles, types]);
  const needsYear = effective.some((t) => t.requiresYear);
  const needsBusiness = effective.some((t) => t.needsBusiness);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="client_id" value={clientId} />
      <Field label="Bundle (optional)" htmlFor="bundle_id">
        <Select
          id="bundle_id"
          name="bundle_id"
          value={bundleId}
          onChange={(e) => setBundleId(e.target.value)}
        >
          <option value="">No bundle</option>
          {bundles.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-neutral-800">Document types</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {types.map((t) => {
            const inBundle =
              bundles.find((b) => b.id === bundleId)?.typeIds.includes(t.id) ?? false;
            return (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="document_type_ids"
                  value={t.id}
                  checked={picked.has(t.id) || inBundle}
                  disabled={inBundle}
                  onChange={() => toggle(t.id)}
                  className="size-4 accent-brand-700"
                />
                {t.name}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {needsYear ? (
          <Field label="Tax year" htmlFor="tax_year" error={errors.tax_year}>
            <Input
              id="tax_year"
              name="tax_year"
              type="number"
              inputMode="numeric"
              min={1990}
              max={2100}
              defaultValue={defaultTaxYear}
            />
          </Field>
        ) : null}
        {needsBusiness ? (
          <Field
            label="Business name"
            htmlFor="business_name"
            error={errors.business_name}
            hint="Used for the business folder in SharePoint."
          >
            <Input id="business_name" name="business_name" maxLength={120} />
          </Field>
        ) : null}
        <Field label="Due date (optional)" htmlFor="due_date" error={errors.due_date}>
          <Input id="due_date" name="due_date" type="date" />
        </Field>
      </div>
      <Field
        label="Note to client (optional)"
        htmlFor="note_to_client"
        error={errors.note_to_client}
        hint="Shown on each request and in the email. Do not include SSNs or account numbers."
      >
        <Textarea id="note_to_client" name="note_to_client" maxLength={1000} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notify" defaultChecked className="size-4 accent-brand-700" />
        Email the client that documents are requested
      </label>
      <ActionMessage state={state} />
      <SubmitButton disabled={effective.length === 0} pendingLabel="Requesting…">
        Request {effective.length || ''} document{effective.length === 1 ? '' : 's'}
      </SubmitButton>
    </form>
  );
}
