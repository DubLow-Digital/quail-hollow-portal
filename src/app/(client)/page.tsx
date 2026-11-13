import Link from 'next/link';
import { requireClient } from '@/lib/auth/client';
import { REQUEST_STATUS, formatDate } from '@/lib/status';
import { firmDateStamp } from '@/lib/naming/filename';
import { Alert, Badge, EmptyState, cx } from '@/components/ui';

export const metadata = { title: 'Your documents' };

export default async function ChecklistPage() {
  const { client, supabase } = await requireClient();

  // Row level security limits this to the signed-in client's own requests.
  const { data: requests, error } = await supabase
    .from('document_requests')
    .select(
      'id, status, tax_year, business_name, note_to_client, redo_note, due_date, requested_at, status_changed_at, document_types(name, sort_order)',
    );

  const today = firmDateStamp(new Date());
  const all = requests ?? [];
  const byDue = (a: (typeof all)[number], b: (typeof all)[number]) =>
    (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31') ||
    (a.document_types?.sort_order ?? 0) - (b.document_types?.sort_order ?? 0);
  const outstanding = all
    .filter((r) => r.status === 'requested' || r.status === 'redo')
    .sort(byDue);
  const received = all
    .filter((r) => r.status === 'uploaded' || r.status === 'accepted')
    .sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-900">Hello, {client.first_name}</h1>
        <p className="mt-1 text-neutral-700">
          {outstanding.length
            ? `We need ${outstanding.length} document${outstanding.length === 1 ? '' : 's'} from you. Tap one to send it.`
            : 'You are all caught up. Thank you!'}
        </p>
      </div>

      {error ? (
        <Alert tone="error">We could not load your list. Please refresh the page.</Alert>
      ) : null}

      <section aria-labelledby="needed-heading" className="space-y-3">
        <h2
          id="needed-heading"
          className="text-sm font-semibold tracking-wide text-neutral-600 uppercase"
        >
          Still needed
        </h2>
        {outstanding.length === 0 ? (
          <EmptyState title="Nothing needed right now" />
        ) : (
          <ul className="space-y-3">
            {outstanding.map((r) => {
              const overdue = r.due_date && r.due_date < today;
              return (
                <li key={r.id}>
                  <Link
                    href={`/request/${r.id}`}
                    className={cx(
                      'block rounded-2xl bg-white p-4 shadow-sm ring-1 transition hover:ring-brand-500 active:scale-[0.99]',
                      r.status === 'redo' ? 'ring-red-300' : 'ring-black/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-medium text-brand-900">
                          {r.document_types?.name ?? 'Document'}
                          {r.tax_year ? ` (${r.tax_year})` : ''}
                        </p>
                        {r.business_name ? (
                          <p className="text-sm text-neutral-600">For {r.business_name}</p>
                        ) : null}
                        {r.due_date ? (
                          <p
                            className={cx(
                              'mt-1 text-sm',
                              overdue ? 'font-medium text-red-700' : 'text-neutral-600',
                            )}
                          >
                            {overdue ? 'Past due' : 'Due'} {formatDate(r.due_date)}
                          </p>
                        ) : null}
                        {r.status === 'redo' && r.redo_note ? (
                          <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-900">
                            {r.redo_note}
                          </p>
                        ) : null}
                      </div>
                      <Badge tone={REQUEST_STATUS[r.status].tone}>
                        {REQUEST_STATUS[r.status].client}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-medium text-brand-700">Send this document →</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {received.length ? (
        <section aria-labelledby="received-heading" className="space-y-3">
          <h2
            id="received-heading"
            className="text-sm font-semibold tracking-wide text-neutral-600 uppercase"
          >
            Received
          </h2>
          <ul className="space-y-2">
            {received.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/request/${r.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-black/5 hover:bg-white"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-emerald-600">
                      ✓
                    </span>
                    <span>
                      {r.document_types?.name ?? 'Document'}
                      {r.tax_year ? ` (${r.tax_year})` : ''}
                    </span>
                  </span>
                  <Badge tone={REQUEST_STATUS[r.status].tone}>
                    {REQUEST_STATUS[r.status].client}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
