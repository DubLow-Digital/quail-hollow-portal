'use client';

import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { Button, Field, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { ActionMessage } from '@/components/action-forms';

/** "Needs redo" with a required note to the client. */
export function RedoForm({
  requestId,
  action,
}: {
  requestId: string;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, { ok: false });

  if (!open && !state.message) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Needs redo
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-2" noValidate>
      <input type="hidden" name="request_id" value={requestId} />
      {!state.ok ? (
        <>
          <Field
            label="What should the client fix?"
            htmlFor={`redo-${requestId}`}
            error={state.fieldErrors?.redo_note}
          >
            <Textarea
              id={`redo-${requestId}`}
              name="redo_note"
              maxLength={1000}
              placeholder="For example: the photo is blurry, please retake it in good light."
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="notify"
              defaultChecked
              className="size-4 accent-brand-700"
            />
            Email the client
          </label>
          <div className="flex gap-2">
            <SubmitButton variant="danger" size="sm" pendingLabel="Sending…">
              Send back for redo
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}
      <ActionMessage state={state} />
    </form>
  );
}
