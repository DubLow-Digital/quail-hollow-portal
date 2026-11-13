import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { UUID_RE } from '@/lib/actions';
import { Card, PageHeader } from '@/components/ui';
import { DocumentTypeForm } from '../document-type-form';
import { saveDocumentTypeAction } from '../actions';

export const metadata = { title: 'Edit document type' };

export default async function EditDocumentTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { data: type } = await serviceSupabase()
    .from('document_types')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!type) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={type.name}
        description="Changes apply to new uploads. Files already saved keep their names."
      />
      <Card>
        <DocumentTypeForm action={saveDocumentTypeAction} values={type} />
      </Card>
    </div>
  );
}
