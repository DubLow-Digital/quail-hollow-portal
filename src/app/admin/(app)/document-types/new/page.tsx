import { requireAdmin } from '@/lib/auth/admin';
import { Card, PageHeader } from '@/components/ui';
import { DocumentTypeForm } from '../document-type-form';
import { saveDocumentTypeAction } from '../actions';

export const metadata = { title: 'New document type' };

export default async function NewDocumentTypePage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New document type" />
      <Card>
        <DocumentTypeForm action={saveDocumentTypeAction} />
      </Card>
    </div>
  );
}
