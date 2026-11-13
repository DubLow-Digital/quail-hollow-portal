import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireClient } from '@/lib/auth/client';
import { serviceSupabase } from '@/lib/supabase/admin';
import { UUID_RE } from '@/lib/actions';
import { REQUEST_STATUS, formatDate, formatDateTime } from '@/lib/status';
import { Alert, Badge } from '@/components/ui';
import { UploadPanel } from '@/components/client/upload-panel';
import { OFFICE_PHONE, OFFICE_PHONE_HREF } from '@/components/client/brand';

export const metadata = { title: 'Send a document' };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { client, supabase } = await requireClient();

  // Row level security returns nothing if this request belongs to someone else.
  const { data: req } = await supabase
    .from('document_requests')
    .select(
      'id, status, tax_year, business_name, note_to_client, redo_note, due_date, document_types(name, description, accepted_mime, max_mb), uploads(id, final_filename, status, uploaded_at)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!req || !req.document_types) notFound();

  const { data: folder } = await serviceSupabase()
    .from('clients')
    .select('sharepoint_folder_id')
    .eq('id', client.id)
    .maybeSingle();
  const ready = Boolean(folder?.sharepoint_folder_id);

  const type = req.document_types;
  const title = `${type.name}${req.tax_year ? ` (${req.tax_year})` : ''}`;
  const sent = req.uploads
    .filter((u) => u.status === 'complete')
    .sort((a, b) => (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''));
  const status = REQUEST_STATUS[req.status];

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700"
      >
        ← Back to my list
      </Link>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-serif text-2xl font-semibold text-brand-900">{title}</h1>
          <Badge tone={status.tone}>{status.client}</Badge>
        </div>
        {req.business_name ? <p className="text-neutral-700">For {req.business_name}</p> : null}
        {req.due_date ? (
          <p className="text-sm text-neutral-600">Due {formatDate(req.due_date)}</p>
        ) : null}
        {type.description ? <p className="text-neutral-700">{type.description}</p> : null}
        {req.note_to_client ? (
          <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
            <p className="font-medium">Note from Quail Hollow</p>
            <p className="mt-1">{req.note_to_client}</p>
          </div>
        ) : null}
        {req.status === 'redo' && req.redo_note ? (
          <Alert tone="warning" title="Please send this again">
            {req.redo_note}
          </Alert>
        ) : null}
      </div>

      {req.status === 'accepted' ? (
        <Alert tone="success" title="Complete">
          We have everything we need for this item. Thank you!
        </Alert>
      ) : !ready ? (
        <Alert tone="warning" title="Almost ready">
          We are still setting up your secure folder. Please check back soon, or call{' '}
          <a href={OFFICE_PHONE_HREF} className="font-medium underline">
            {OFFICE_PHONE}
          </a>
          .
        </Alert>
      ) : (
        <UploadPanel
          requestId={req.id}
          documentName={type.name}
          acceptedMime={type.accepted_mime}
          maxMb={type.max_mb}
        />
      )}

      {sent.length ? (
        <section aria-labelledby="sent-heading" className="space-y-2">
          <h2
            id="sent-heading"
            className="text-sm font-semibold tracking-wide text-neutral-600 uppercase"
          >
            You have sent
          </h2>
          <ul className="space-y-1 text-sm">
            {sent.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-black/5"
              >
                <span className="truncate">{u.final_filename}</span>
                <span className="shrink-0 text-neutral-500">{formatDateTime(u.uploaded_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
