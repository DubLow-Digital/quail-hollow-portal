'use client';

import { useActionState, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { MIME_LABELS, SUPPORTED_MIME_TYPES } from '@/lib/files/types';
import { DEFAULT_NAMING_TEMPLATE, buildFilename } from '@/lib/naming/filename';
import { Field, Input, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ActionMessage } from '@/components/action-forms';

export interface DocumentTypeValues {
  id?: string;
  name?: string;
  description?: string;
  slug_for_filename?: string;
  naming_template?: string;
  target_subfolder?: string;
  accepted_mime?: string[];
  max_mb?: number;
  requires_year?: boolean;
  active?: boolean;
  sort_order?: number;
}

export function DocumentTypeForm({
  action,
  values = {},
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  values?: DocumentTypeValues;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const errors = state.fieldErrors ?? {};
  const [template, setTemplate] = useState(values.naming_template ?? DEFAULT_NAMING_TEMPLATE);
  const [slug, setSlug] = useState(values.slug_for_filename ?? '');
  const [requiresYear, setRequiresYear] = useState(values.requires_year ?? false);
  const accepted = values.accepted_mime ?? [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
  ];

  const preview = useMemo(() => {
    try {
      return buildFilename(template, {
        firstName: 'Jane',
        lastName: 'Smith',
        docSlug: slug || 'DocSlug',
        taxYear: requiresYear ? new Date().getFullYear() - 1 : null,
        businessName: 'Acme Widgets',
        extension: 'pdf',
        date: new Date(),
      });
    } catch (err) {
      return `⚠ ${(err as Error).message}`;
    }
  }, [template, slug, requiresYear]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name (shown to clients)" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" defaultValue={values.name} required maxLength={120} />
        </Field>
        <Field
          label="Filename slug"
          htmlFor="slug_for_filename"
          error={errors.slug_for_filename}
          hint="Used in the filename, e.g. DriversLicense."
        >
          <Input
            id="slug_for_filename"
            name="slug_for_filename"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            maxLength={40}
          />
        </Field>
      </div>
      <Field label="Instructions for the client" htmlFor="description" error={errors.description}>
        <Textarea
          id="description"
          name="description"
          defaultValue={values.description}
          maxLength={1000}
        />
      </Field>
      <Field
        label="Naming template"
        htmlFor="naming_template"
        error={errors.naming_template}
        hint={
          <>
            Tokens:{' '}
            {'{FirstInitial} {FirstName} {LastName} {DocSlug} {TaxYear} {Business} {YYYY-MM-DD}'}.
            Wrap optional parts in [ ]. Must end with .{'{ext}'}. Example:{' '}
            <code className="font-mono">{preview}</code>
          </>
        }
      >
        <Input
          id="naming_template"
          name="naming_template"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="font-mono text-sm"
          maxLength={200}
        />
      </Field>
      <Field
        label="Target subfolder"
        htmlFor="target_subfolder"
        error={errors.target_subfolder}
        hint="Inside the client's folder. Use {year} for the tax year and {business} for the business name, e.g. Individual/Tax Returns/{year}."
      >
        <Input
          id="target_subfolder"
          name="target_subfolder"
          defaultValue={values.target_subfolder}
          maxLength={300}
        />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-neutral-800">Accepted file types</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SUPPORTED_MIME_TYPES.map((mime) => (
            <label key={mime} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="accepted_mime"
                value={mime}
                defaultChecked={accepted.includes(mime)}
                className="size-4 accent-brand-700"
              />
              {MIME_LABELS[mime] ?? mime}
            </label>
          ))}
        </div>
        {errors.accepted_mime ? (
          <p className="mt-1 text-sm text-red-700">{errors.accepted_mime}</p>
        ) : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Max size (MB)" htmlFor="max_mb" error={errors.max_mb}>
          <Input
            id="max_mb"
            name="max_mb"
            type="number"
            min={1}
            max={250}
            defaultValue={values.max_mb ?? 50}
          />
        </Field>
        <Field label="Sort order" htmlFor="sort_order" error={errors.sort_order}>
          <Input
            id="sort_order"
            name="sort_order"
            type="number"
            min={0}
            defaultValue={values.sort_order ?? 100}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="requires_year"
            checked={requiresYear}
            onChange={(e) => setRequiresYear(e.target.checked)}
            className="size-4 accent-brand-700"
          />
          Requires a tax year
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={values.active ?? true}
            className="size-4 accent-brand-700"
          />
          Active (available for new requests)
        </label>
      </div>
      <ActionMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save document type</SubmitButton>
    </form>
  );
}
