import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { MIME_LABELS } from '@/lib/files/types';
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: 'Document types' };

export default async function DocumentTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;
  const { data: types } = await serviceSupabase()
    .from('document_types')
    .select(
      'id, name, slug_for_filename, target_subfolder, accepted_mime, max_mb, requires_year, active',
    )
    .order('sort_order')
    .order('name');

  return (
    <div>
      <PageHeader
        title="Document types"
        description="What you can request, how each file is named, and where it is filed."
        actions={<LinkButton href="/admin/document-types/new">New document type</LinkButton>}
      />
      {saved ? (
        <div className="mb-4">
          <Alert tone="success">Document type saved.</Alert>
        </div>
      ) : null}
      {!types?.length ? (
        <EmptyState title="No document types yet" />
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-neutral-100">
            {types.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/document-types/${t.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-brand-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-brand-900">{t.name}</p>
                    <p className="truncate text-sm text-neutral-600">
                      {t.target_subfolder || '(client folder)'} · {t.slug_for_filename} · up to{' '}
                      {t.max_mb} MB
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {t.accepted_mime.map((m) => MIME_LABELS[m] ?? m).join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {t.requires_year ? <Badge tone="blue">Tax year</Badge> : null}
                    {t.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
