import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { CLIENT_STATUS } from '@/lib/status';
import type { ClientStatus } from '@/lib/db/types';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Select,
  buttonClass,
} from '@/components/ui';

export const metadata = { title: 'Clients' };

const STATUSES: (ClientStatus | 'all')[] = ['all', 'invited', 'active', 'archived'];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 100);
  const status = STATUSES.includes(params.status as ClientStatus)
    ? (params.status as ClientStatus)
    : null;

  const db = serviceSupabase();
  let query = db
    .from('clients')
    .select(
      'id, first_name, last_name, email, status, sharepoint_folder_id, document_requests(status)',
    )
    .order('last_name')
    .order('first_name')
    .limit(500);
  if (status) query = query.eq('status', status);
  else query = query.neq('status', 'archived');
  if (q) {
    // Escape PostgREST filter syntax characters before building the OR filter.
    const safe = q.replace(/[%_,().*\\]/g, ' ').trim();
    if (safe)
      query = query.or(
        `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%`,
      );
  }
  const { data: clients, error } = await query;

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Everyone who can sign in to the portal."
        actions={
          <>
            <LinkButton href="/admin/clients/import" variant="secondary">
              Import
            </LinkButton>
            <LinkButton href="/admin/clients/new">Add client</LinkButton>
          </>
        }
      />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search name or email"
          aria-label="Search clients"
        />
        <Select
          name="status"
          defaultValue={status ?? 'all'}
          aria-label="Status"
          className="sm:w-44"
        >
          <option value="all">Current clients</option>
          <option value="invited">Invited</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </form>

      {error ? (
        <EmptyState title="Could not load clients">Please refresh the page.</EmptyState>
      ) : !clients?.length ? (
        <EmptyState title={q ? 'No clients match that search' : 'No clients yet'}>
          {q
            ? 'Try a different name or email.'
            : 'Add your first client to send them a document request.'}
        </EmptyState>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-neutral-100">
            {clients.map((c) => {
              const outstanding = c.document_requests.filter(
                (r) => r.status === 'requested' || r.status === 'redo',
              ).length;
              const toReview = c.document_requests.filter((r) => r.status === 'uploaded').length;
              return (
                <li key={c.id}>
                  <Link
                    href={`/admin/clients/${c.id}`}
                    className="flex flex-col gap-1 px-4 py-3 hover:bg-brand-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium text-brand-900">
                        {c.last_name}, {c.first_name}
                      </p>
                      <p className="text-sm text-neutral-600">{c.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!c.sharepoint_folder_id ? <Badge tone="red">No folder</Badge> : null}
                      {outstanding ? <Badge tone="amber">{outstanding} outstanding</Badge> : null}
                      {toReview ? <Badge tone="blue">{toReview} to review</Badge> : null}
                      <Badge tone={CLIENT_STATUS[c.status].tone}>
                        {CLIENT_STATUS[c.status].label}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
