import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { syncConfigured } from '@/lib/env';
import { HubError, SYNC_ERROR_MESSAGES, searchCandidates } from '@/lib/sync/hub';
import { normalizeGhlId, normalizeNotionId, type Candidate } from '@/lib/sync/protocol';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  buttonClass,
} from '@/components/ui';
import { ActionButtonForm } from '@/components/action-forms';
import { importClientAction } from '../sync-actions';

export const metadata = { title: 'Import client' };

const SOURCES = { ghl: 'Lead Alchemist', notion: 'Notion' } as const;
type Source = keyof typeof SOURCES;

export default async function ImportClientPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const source: Source = params.source === 'notion' ? 'notion' : 'ghl';
  const q = (params.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);

  if (!syncConfigured()) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Import client" />
        <EmptyState title="Notion and Lead Alchemist sync is not set up yet">
          Add SYNC_HUB_URL and SYNC_HUB_SECRET (see docs/sync.md), then import clients from here.
        </EmptyState>
      </div>
    );
  }

  let candidates: Candidate[] = [];
  let error: string | null = null;
  if (q.length >= 2) {
    try {
      candidates = await searchCandidates(source, q);
    } catch (err) {
      const code = err instanceof HubError ? err.code : 'unexpected';
      error = SYNC_ERROR_MESSAGES[code] ?? 'Search failed. Please try again.';
    }
  }

  // Which results are already portal clients (by email or by link)?
  const db = serviceSupabase();
  const emails = candidates
    .map((c) => c.email?.trim().toLowerCase())
    .filter((e): e is string => !!e);
  const notionIds = candidates
    .map((c) => normalizeNotionId(c.notion_page_id ?? (c.source === 'notion' ? c.id : null)))
    .filter((v): v is string => !!v);
  const ghlIds = candidates
    .map((c) => normalizeGhlId(c.ghl_contact_id ?? (c.source === 'ghl' ? c.id : null)))
    .filter((v): v is string => !!v);
  const [byEmail, byNotion, byGhl] = candidates.length
    ? await Promise.all([
        emails.length ? db.from('clients').select('id, email').in('email', emails) : { data: [] },
        notionIds.length
          ? db.from('clients').select('id, notion_page_id').in('notion_page_id', notionIds)
          : { data: [] },
        ghlIds.length
          ? db.from('clients').select('id, ghl_contact_id').in('ghl_contact_id', ghlIds)
          : { data: [] },
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const existingFor = (c: Candidate): string | null => {
    const email = c.email?.trim().toLowerCase();
    const n = normalizeNotionId(c.notion_page_id ?? (c.source === 'notion' ? c.id : null));
    const g = normalizeGhlId(c.ghl_contact_id ?? (c.source === 'ghl' ? c.id : null));
    return (
      (byEmail.data ?? []).find((r) => 'email' in r && r.email === email)?.id ??
      (byNotion.data ?? []).find((r) => 'notion_page_id' in r && r.notion_page_id === n)?.id ??
      (byGhl.data ?? []).find((r) => 'ghl_contact_id' in r && r.ghl_contact_id === g)?.id ??
      null
    );
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Import client"
        description="Bring in someone who is already in Lead Alchemist or Notion. They are linked in both, and no invite is sent until you send it."
      />
      <form className="flex flex-col gap-2 sm:flex-row" role="search">
        <Select name="source" defaultValue={source} aria-label="Import from" className="sm:w-48">
          <option value="ghl">Lead Alchemist</option>
          <option value="notion">Notion</option>
        </Select>
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Name, email or phone"
          aria-label="Search"
          minLength={2}
          maxLength={100}
          required
        />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {q.length >= 2 && !error ? (
        candidates.length === 0 ? (
          <EmptyState title={`No matches in ${SOURCES[source]}`}>
            Try a different spelling, or the email address.
          </EmptyState>
        ) : (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-neutral-100">
              {candidates.map((c) => {
                const existing = existingFor(c);
                const name =
                  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || '(no name)';
                return (
                  <li
                    key={`${c.source}:${c.id}`}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-brand-900">{name}</p>
                      <p className="truncate text-sm text-neutral-600">
                        {[c.email, c.phone, c.company && c.company !== name ? c.company : null]
                          .filter(Boolean)
                          .join(' · ') || 'No contact details'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.status ? <Badge>{c.status}</Badge> : null}
                        {c.client_type ? <Badge tone="blue">{c.client_type}</Badge> : null}
                        {c.source === 'ghl' && c.notion_page_id ? (
                          <Badge tone="green">Also in Notion</Badge>
                        ) : null}
                        {c.source === 'notion' && c.ghl_contact_id ? (
                          <Badge tone="green">Also in Lead Alchemist</Badge>
                        ) : null}
                      </div>
                    </div>
                    {existing ? (
                      <Link
                        href={`/admin/clients/${existing}`}
                        className={buttonClass('ghost', 'sm')}
                      >
                        Already in portal →
                      </Link>
                    ) : (
                      <ActionButtonForm
                        action={importClientAction}
                        hidden={{ source: c.source, id: c.id }}
                        label="Import"
                        pendingLabel="Importing…"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )
      ) : null}
    </div>
  );
}
