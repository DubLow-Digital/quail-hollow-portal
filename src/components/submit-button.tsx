'use client';

import { useFormStatus } from 'react-dom';
import type { ComponentProps } from 'react';
import { Button } from './ui';

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? 'Working…') : children}
    </Button>
  );
}
