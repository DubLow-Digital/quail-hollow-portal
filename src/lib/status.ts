import type { ClientStatus, RequestStatus, UploadStatus } from '@/lib/db/types';

/** Labels and badge tones for statuses, shared by client and admin screens. */

export const REQUEST_STATUS: Record<
  RequestStatus,
  { client: string; admin: string; tone: 'amber' | 'blue' | 'green' | 'red' }
> = {
  requested: { client: 'Needed', admin: 'Requested', tone: 'amber' },
  uploaded: { client: 'Received', admin: 'Uploaded', tone: 'blue' },
  accepted: { client: 'Complete', admin: 'Accepted', tone: 'green' },
  redo: { client: 'Please resend', admin: 'Needs redo', tone: 'red' },
};

export const CLIENT_STATUS: Record<
  ClientStatus,
  { label: string; tone: 'amber' | 'green' | 'neutral' }
> = {
  invited: { label: 'Invited', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export const UPLOAD_STATUS: Record<
  UploadStatus,
  { label: string; tone: 'amber' | 'green' | 'red' }
> = {
  pending: { label: 'In progress', tone: 'amber' },
  complete: { label: 'Received', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
};

export const ENTITY_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'schedule_c', label: 'Schedule C' },
  { value: '1120s', label: '1120-S' },
  { value: '1065', label: '1065' },
  { value: 'other', label: 'Other' },
] as const;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/New_York',
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  // Plain dates (YYYY-MM-DD) are calendar dates; avoid shifting them across time zones.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return dateFormatter.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFormatter.format(new Date(value)) : '';
}
