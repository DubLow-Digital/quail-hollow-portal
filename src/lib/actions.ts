import type { z } from 'zod';

/** Result shape returned by server actions to `useActionState` forms. */
export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialActionState: ActionState = { ok: false };

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function invalid(
  error: z.ZodError,
  message = 'Please fix the highlighted fields.',
): ActionState {
  return { ok: false, message, fieldErrors: fieldErrorsFrom(error) };
}

/** Reads a FormData field as a trimmed string ('' when missing). */
export function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function strs(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
