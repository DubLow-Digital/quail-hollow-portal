import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { Card, PageHeader } from '@/components/ui';
import { ActionButtonForm } from '@/components/action-forms';
import { BundleForm } from './bundle-form';
import { deleteBundleAction, saveBundleAction } from './actions';

export const metadata = { title: 'Bundles' };

export default async function BundlesPage() {
  await requireAdmin();
  const db = serviceSupabase();
  const [{ data: bundles }, { data: types }] = await Promise.all([
    db
      .from('request_bundles')
      .select('id, name, description, request_bundle_items(document_type_id)')
      .order('name'),
    db.from('document_types').select('id, name, active').order('sort_order').order('name'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request bundles"
        description="Preset groups of document types you can request in one step."
      />
      {(bundles ?? []).map((b) => (
        <Card key={b.id}>
          <BundleForm
            action={saveBundleAction}
            types={types ?? []}
            submitLabel="Save bundle"
            values={{
              id: b.id,
              name: b.name,
              description: b.description,
              document_type_ids: b.request_bundle_items.map((i) => i.document_type_id),
            }}
          />
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <ActionButtonForm
              action={deleteBundleAction}
              hidden={{ id: b.id }}
              label="Delete bundle"
              variant="ghost"
              confirm={`Delete the bundle "${b.name}"? Existing requests are not affected.`}
            />
          </div>
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-brand-900">New bundle</h2>
        <BundleForm action={saveBundleAction} types={types ?? []} submitLabel="Create bundle" />
      </Card>
    </div>
  );
}
