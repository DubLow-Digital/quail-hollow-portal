import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { UUID_RE } from '@/lib/actions';
import { CLIENT_STATUS, formatDateTime } from '@/lib/status';
import { Alert, Badge, Card, PageHeader } from '@/components/ui';
import { ActionButtonForm } from '@/components/action-forms';
import { ClientForm } from '../client-form';
import { FolderBrowser } from '../folder-browser';
import {
  createFolderAction,
  linkFolderAction,
  setArchivedAction,
  unlinkFolderAction,
  updateClientAction,
} from '../actions';

export const metadata = { title: 'Client' };

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const db = serviceSupabase();
  const { data: client } = await db.from('clients').select('*').eq('id', id).maybeSingle();
  if (!client) notFound();

  const status = CLIENT_STATUS[client.status];
  const archived = client.status === 'archived';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${client.first_name} ${client.last_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{client.email}</span>
            {client.last_login_at ? (
              <span>· Last sign-in {formatDateTime(client.last_login_at)}</span>
            ) : null}
          </span>
        }
      />
      {created ? (
        <Alert tone="success" title="Client added">
          Link or create their SharePoint folder, then request documents.
        </Alert>
      ) : null}
      {archived ? (
        <Alert tone="warning" title="Archived">
          This client cannot sign in or see any requests.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-brand-900">SharePoint folder</h2>
          {client.sharepoint_folder_id ? (
            <div className="space-y-3">
              <p className="text-sm">
                Linked to <span className="font-medium">{client.sharepoint_folder_path}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {client.sharepoint_folder_web_url ? (
                  <a
                    href={client.sharepoint_folder_web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                  >
                    Open in SharePoint ↗
                  </a>
                ) : null}
                <ActionButtonForm
                  action={unlinkFolderAction}
                  hidden={{ client_id: client.id }}
                  label="Unlink folder"
                  variant="ghost"
                  confirm="Unlink this folder? Nothing in SharePoint is deleted."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <Alert tone="warning">
                Uploads are blocked until this client has a folder. Link their existing folder or
                create a new one.
              </Alert>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-neutral-800">
                  Link existing folder
                </h3>
                <FolderBrowser clientId={client.id} action={linkFolderAction} />
              </div>
              <div className="border-t border-neutral-100 pt-4">
                <h3 className="mb-1 text-sm font-semibold text-neutral-800">
                  Or create a new folder
                </h3>
                <p className="mb-2 text-sm text-neutral-600">
                  Creates “{client.last_name}, {client.first_name}” with Individual (ID, Tax
                  Returns, Income Documents), Businesses and Dependents.
                </p>
                <ActionButtonForm
                  action={createFolderAction}
                  hidden={{ client_id: client.id }}
                  label="Create folder"
                  pendingLabel="Creating…"
                />
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-brand-900">Profile</h2>
          <ClientForm
            action={updateClientAction}
            submitLabel="Save changes"
            values={{
              id: client.id,
              first_name: client.first_name,
              last_name: client.last_name,
              email: client.email,
              phone: client.phone,
              entity_types: client.entity_types,
            }}
          />
          <div className="mt-6 border-t border-neutral-100 pt-4">
            <ActionButtonForm
              action={setArchivedAction}
              hidden={{ client_id: client.id, archive: archived ? '0' : '1' }}
              label={archived ? 'Restore client' : 'Archive client'}
              variant={archived ? 'secondary' : 'danger'}
              confirm={
                archived
                  ? undefined
                  : 'Archive this client? They will no longer be able to sign in.'
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
