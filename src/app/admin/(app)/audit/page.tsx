import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { UUID_RE } from '@/lib/actions';
import { formatDateTime } from '@/lib/status';
import { Badge, Card, EmptyState, Input, PageHeader, Select, buttonClass } from '@/components/ui';

export const metadata = { title: 'Audit log' };

const PAGE_SIZE = 100;
const ACTOR_TYPES = ['client', 'admin', 'system'] as const;
const ACTION_GROUPS = [
  { value: 'admin.', label: 'Admin sign-ins' },
  { value: 'client.', label: 'Client sign-ins and changes' },
  { value: 'request.', label: 'Requests' },
  { value: 'upload.', label: 'Uploads' },
  { value: 'document_type.', label: 'Document types' },
  { value: 'bundle.', label: 'Bundles' },
  { value: 'email.', label: 'Emails' },
  { value: 'file.', label: 'File downloads' },
  { value: 'sync.', label: 'Notion and Lead Alchemist sync' },
];

type SearchParams = {
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
  before?: string;
};

function dateBound(value: string | undefined, endOfDay: boolean): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Interpret dates in Florida time (EST/EDT); a 5-hour offset is close enough for filtering.
  return `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}-05:00`;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const actor = ACTOR_TYPES.find((a) => a === params.actor) ?? null;
  const action = ACTION_GROUPS.find((g) => g.value === params.action)?.value ?? null;
  const target = params.target && UUID_RE.test(params.target) ? params.target : null;
  const from = dateBound(params.from, false);
  const to = dateBound(params.to, true);
  const before = params.before && /^\d+$/.test(params.before) ? Number(params.before) : null;

  const db = serviceSupabase();
  let query = db
    .from('audit_log')
    .select('id, actor_type, actor_id, action, target_type, target_id, metadata, ip, created_at')
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (actor) query = query.eq('actor_type', actor);
  if (action) query = query.like('action', `${action}%`);
  if (target) query = query.or(`target_id.eq.${target},actor_id.eq.${target}`);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (before) query = query.lt('id', before);
  const { data: rows, error } = await query;

  // Resolve IDs to names for display only (names never go into the audit table).
  const ids = new Set<string>();
  for (const r of rows ?? []) {
    if (r.actor_id) ids.add(r.actor_id);
    if (r.target_id && (r.target_type === 'client' || r.target_type === 'admin'))
      ids.add(r.target_id);
  }
  const idList = [...ids];
  const [{ data: clients }, { data: admins }] = idList.length
    ? await Promise.all([
        db.from('clients').select('id, first_name, last_name').in('id', idList),
        db.from('admins').select('id, display_name, email').in('id', idList),
      ])
    : [{ data: [] }, { data: [] }];
  const names = new Map<string, string>();
  for (const c of clients ?? []) names.set(c.id, `${c.first_name} ${c.last_name}`);
  for (const a of admins ?? []) names.set(a.id, a.display_name || a.email);

  const nextCursor = rows && rows.length === PAGE_SIZE ? rows[rows.length - 1]!.id : null;
  const keep = new URLSearchParams(
    Object.entries({
      actor: actor ?? '',
      action: action ?? '',
      target: target ?? '',
      from: params.from ?? '',
      to: params.to ?? '',
    }).filter(([, v]) => v),
  );

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every sign-in, upload, email and admin action. IDs and event types only."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-6" role="search">
        <Select name="actor" defaultValue={actor ?? ''} aria-label="Actor type">
          <option value="">Anyone</option>
          <option value="client">Clients</option>
          <option value="admin">Admins</option>
          <option value="system">System</option>
        </Select>
        <Select
          name="action"
          defaultValue={action ?? ''}
          aria-label="Event type"
          className="sm:col-span-2"
        >
          <option value="">All events</option>
          {ACTION_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
        <Input name="from" type="date" defaultValue={params.from} aria-label="From date" />
        <Input name="to" type="date" defaultValue={params.to} aria-label="To date" />
        <button type="submit" className={buttonClass('secondary')}>
          Filter
        </button>
        <Input
          name="target"
          defaultValue={target ?? ''}
          placeholder="Record ID (client, request, upload…)"
          aria-label="Record ID"
          className="font-mono text-sm sm:col-span-6"
        />
      </form>

      {error ? (
        <EmptyState title="Could not load the audit log" />
      ) : !rows?.length ? (
        <EmptyState title="No matching events" />
      ) : (
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-50 text-xs text-neutral-600 uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Details</th>
                <th className="px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        r.actor_type === 'admin'
                          ? 'blue'
                          : r.actor_type === 'client'
                            ? 'green'
                            : 'neutral'
                      }
                    >
                      {r.actor_type}
                    </Badge>{' '}
                    {r.actor_id ? (
                      <Link href={`/admin/audit?target=${r.actor_id}`} className="hover:underline">
                        {names.get(r.actor_id) ?? r.actor_id.slice(0, 8)}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.target_type && r.target_id ? (
                      r.target_type === 'client' ? (
                        <Link href={`/admin/clients/${r.target_id}`} className="hover:underline">
                          {names.get(r.target_id) ?? `client ${r.target_id.slice(0, 8)}`}
                        </Link>
                      ) : (
                        <Link
                          href={`/admin/audit?target=${r.target_id}`}
                          className="font-mono hover:underline"
                        >
                          {r.target_type} {r.target_id.slice(0, 8)}
                        </Link>
                      )
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-600">
                    {r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
                      ? Object.entries(r.metadata)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(' ')
                      : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{r.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {nextCursor ? (
        <div className="mt-4">
          <Link
            href={`/admin/audit?${new URLSearchParams([...keep.entries(), ['before', String(nextCursor)]])}`}
            className={buttonClass('secondary')}
          >
            Older events
          </Link>
        </div>
      ) : null}
    </div>
  );
}
