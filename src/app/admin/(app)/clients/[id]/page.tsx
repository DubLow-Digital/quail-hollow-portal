import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { UUID_RE } from '@/lib/actions';
import {
  CLIENT_STATUS,
  REQUEST_STATUS,
  UPLOAD_STATUS,
  formatDate,
  formatDateTime,
  isAbandonedUpload,
} from '@/lib/status';
import { formatBytes } from '@/lib/files/types';
import { subfolderNeedsBusiness } from '@/lib/naming/folders';
import { firmDateStamp } from '@/lib/naming/filename';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ActionButtonForm } from '@/components/action-forms';
import { ClientForm } from '../client-form';
import { FolderBrowser } from '../folder-browser';
import { AssignRequestsForm } from '../assign-requests-form';
import { RedoForm } from '../redo-form';
import {
  acceptRequestAction,
  assignRequestsAction,
  cancelRequestAction,
  redoRequestAction,
  sendInviteAction,
} from '../request-actions';
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
  const [{ data: client }, { data: requests }, { data: types }, { data: bundles }] =
    await Promise.all([
      db.from('clients').select('*').eq('id', id).maybeSingle(),
      db
        .from('document_requests')
        .select(
          'id, status, tax_year, business_name, note_to_client, redo_note, requested_at, due_date, status_changed_at, document_types(name, sort_order), uploads(id, final_filename, size_bytes, page_count, capture_method, status, uploaded_at, started_at, sharepoint_web_url, failure_reason)',
        )
        .eq('client_id', id)
        .order('requested_at', { ascending: false }),
      db
        .from('document_types')
        .select('id, name, requires_year, target_subfolder')
        .eq('active', true)
        .order('sort_order')
        .order('name'),
      db
        .from('request_bundles')
        .select('id, name, request_bundle_items(document_type_id)')
        .order('name'),
    ]);
  if (!client) notFound();

  const open = (requests ?? []).filter((r) => r.status !== 'accepted');
  const done = (requests ?? []).filter((r) => r.status === 'accepted');
  const currentYear = Number(firmDateStamp(new Date()).slice(0, 4));

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

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-brand-900">Document requests</h2>
          {!archived ? (
            <ActionButtonForm
              action={sendInviteAction}
              hidden={{ client_id: client.id }}
              label={client.invited_at ? 'Resend invite' : 'Send invite'}
              pendingLabel="Sending…"
            />
          ) : null}
        </div>
        {client.invited_at ? (
          <p className="mb-4 text-sm text-neutral-600">
            Last invited {formatDateTime(client.invited_at)}.
          </p>
        ) : null}
        {!client.sharepoint_folder_id && open.length ? (
          <div className="mb-4">
            <Alert tone="warning">
              The client cannot upload until a SharePoint folder is linked.
            </Alert>
          </div>
        ) : null}
        {open.length === 0 && done.length === 0 ? (
          <EmptyState title="No documents requested yet" />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {[...open, ...done].map((r) => {
              const s = REQUEST_STATUS[r.status];
              const uploads = [...r.uploads].sort((a, b) => (b.started_at > a.started_at ? 1 : -1));
              const complete = uploads.filter((u) => u.status === 'complete');
              return (
                <li key={r.id} className="space-y-2 py-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-brand-900">
                        {r.document_types?.name ?? 'Document'}
                        {r.tax_year ? ` (${r.tax_year})` : ''}
                        {r.business_name ? ` · ${r.business_name}` : ''}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Requested {formatDate(r.requested_at)}
                        {r.due_date ? ` · Due ${formatDate(r.due_date)}` : ''}
                        {' · '}Updated {formatDateTime(r.status_changed_at)}
                      </p>
                      {r.note_to_client ? (
                        <p className="mt-1 text-sm text-neutral-700">Note: {r.note_to_client}</p>
                      ) : null}
                      {r.status === 'redo' && r.redo_note ? (
                        <p className="mt-1 text-sm text-red-800">Redo: {r.redo_note}</p>
                      ) : null}
                    </div>
                    <Badge tone={s.tone}>{s.admin}</Badge>
                  </div>
                  {uploads.length ? (
                    <ul className="space-y-1 rounded-xl bg-neutral-50 p-3 text-sm">
                      {uploads.map((u) => (
                        <li
                          key={u.id}
                          className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0 truncate">
                            {u.final_filename}
                            <span className="text-neutral-500">
                              {u.size_bytes ? ` · ${formatBytes(u.size_bytes)}` : ''}
                              {u.page_count && u.page_count > 1 ? ` · ${u.page_count} pages` : ''}
                              {` · ${u.capture_method}`}
                              {u.uploaded_at ? ` · ${formatDateTime(u.uploaded_at)}` : ''}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            {isAbandonedUpload(u.status, u.started_at) ? (
                              <Badge>Did not finish</Badge>
                            ) : (
                              <Badge tone={UPLOAD_STATUS[u.status].tone}>
                                {UPLOAD_STATUS[u.status].label}
                              </Badge>
                            )}
                            {u.status === 'complete' && u.sharepoint_web_url ? (
                              <a
                                href={u.sharepoint_web_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-brand-700 hover:underline"
                              >
                                Open in SharePoint ↗
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap items-start gap-2">
                    {r.status === 'uploaded' ? (
                      <ActionButtonForm
                        action={acceptRequestAction}
                        hidden={{ request_id: r.id }}
                        label="Accept"
                        variant="primary"
                      />
                    ) : null}
                    {r.status === 'uploaded' || r.status === 'accepted' ? (
                      <RedoForm requestId={r.id} action={redoRequestAction} />
                    ) : null}
                    {(r.status === 'requested' || r.status === 'redo') && complete.length === 0 ? (
                      <ActionButtonForm
                        action={cancelRequestAction}
                        hidden={{ request_id: r.id }}
                        label="Remove request"
                        variant="ghost"
                        confirm="Remove this request? The client will no longer see it."
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {!archived ? (
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-brand-900">Request documents</h2>
          <AssignRequestsForm
            clientId={client.id}
            action={assignRequestsAction}
            defaultTaxYear={currentYear - 1}
            types={(types ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              requiresYear: t.requires_year,
              needsBusiness: subfolderNeedsBusiness(t.target_subfolder),
            }))}
            bundles={(bundles ?? []).map((b) => ({
              id: b.id,
              name: b.name,
              typeIds: b.request_bundle_items.map((i) => i.document_type_id),
            }))}
          />
        </Card>
      ) : null}
    </div>
  );
}
