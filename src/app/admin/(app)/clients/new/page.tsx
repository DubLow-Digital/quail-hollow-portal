import { requireAdmin } from '@/lib/auth/admin';
import { Card, PageHeader } from '@/components/ui';
import { ClientForm } from '../client-form';
import { createClientAction } from '../actions';

export const metadata = { title: 'Add client' };

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add client"
        description="Next you can link or create their SharePoint folder and request documents."
      />
      <Card>
        <ClientForm action={createClientAction} submitLabel="Add client" />
      </Card>
    </div>
  );
}
