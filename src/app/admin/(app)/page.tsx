import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { formatDateTime, REQUEST_STATUS } from '@/lib/status';
import { formatBytes } from '@/lib/files/types';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: 'Dashboard' };

export default async function AdminDashboard() {
  const admin = await requireAdmin();
  const db = serviceSupabase();

  const [uploadsRes, openRes] = await Promise.all([
    db
      .from('uploads')
      .select(
        'id, final_filename, size_bytes, uploaded_at, sharepoint_web_url, client_id, request_id, clients(first_name, last_name), document_requests(status)',
      )
      .eq('status', 'complete')
      .order('uploaded_at', { ascending: false })
      .limit(15),
    db
      .from('document_requests')
      .select('client_id, status, due_date, clients!inner(first_name, last_name, status)')
      .in('status', ['requested', 'redo', 'uploaded'])
      .neq('clients.status', 'archived')
      .limit(2000),
  ]);

  type Row = {
    id: string;
    name: string;
    outstanding: number;
    toReview: number;
    nextDue: string | null;
  };
  const byClient = new Map<string, Row>();
  for (const r of openRes.data ?? []) {
    const row = byClient.get(r.client_id) ?? {
      id: r.client_id,
      name: `${r.clients.last_name}, ${r.clients.first_name}`,
      outstanding: 0,
      toReview: 0,
      nextDue: null,
    };
    if (r.status === 'uploaded') row.toReview++;
    else row.outstanding++;
    if (r.status !== 'uploaded' && r.due_date && (!row.nextDue || r.due_date < row.nextDue))
      row.nextDue = r.due_date;
    byClient.set(r.client_id, row);
  }
  const rows = [...byClient.values()].sort(
    (a, b) => b.toReview - a.toReview || b.outstanding - a.outstanding,
  );
  const toReviewTotal = rows.reduce((n, r) => n + r.toReview, 0);
  const outstandingTotal = rows.reduce((n, r) => n + r.outstanding, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${admin.name.split(' ')[0] ?? admin.name}`}
        actions={<LinkButton href="/admin/clients/new">Add client</LinkButton>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-neutral-600">Uploads to review</p>
          <p className="mt-1 text-3xl font-semibold text-brand-900">{toReviewTotal}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-600">Documents still needed</p>
          <p className="mt-1 text-3xl font-semibold text-brand-900">{outstandingTotal}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-600">Clients waiting on</p>
          <p className="mt-1 text-3xl font-semibold text-brand-900">{rows.length}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-brand-900">Recent uploads</h2>
          {uploadsRes.data?.length ? (
            <ul className="divide-y divide-neutral-100">
              {uploadsRes.data.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/clients/${u.client_id}`}
                      className="font-medium text-brand-900 hover:underline"
                    >
                      {u.clients ? `${u.clients.last_name}, ${u.clients.first_name}` : 'Client'}
                    </Link>
                    <p className="truncate text-sm text-neutral-600">
                      {u.final_filename}
                      {u.size_bytes ? ` · ${formatBytes(u.size_bytes)}` : ''}
                    </p>
                    <p className="text-xs text-neutral-500">{formatDateTime(u.uploaded_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.document_requests ? (
                      <Badge tone={REQUEST_STATUS[u.document_requests.status].tone}>
                        {REQUEST_STATUS[u.document_requests.status].admin}
                      </Badge>
                    ) : null}
                    {u.sharepoint_web_url ? (
                      <a
                        href={u.sharepoint_web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Open ↗
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No uploads yet" />
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold text-brand-900">Clients with open requests</h2>
          {rows.length ? (
            <ul className="divide-y divide-neutral-100">
              {rows.slice(0, 25).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/admin/clients/${r.id}`}
                    className="flex items-center justify-between gap-2 py-2.5 hover:bg-brand-50"
                  >
                    <span className="font-medium text-brand-900">{r.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {r.toReview ? <Badge tone="blue">{r.toReview} to review</Badge> : null}
                      {r.outstanding ? <Badge tone="amber">{r.outstanding} needed</Badge> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing outstanding" />
          )}
        </Card>
      </div>
    </div>
  );
}
