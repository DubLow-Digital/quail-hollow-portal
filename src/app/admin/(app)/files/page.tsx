import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/admin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { fileSource } from '@/lib/files/source';
import {
  DRIVE_ITEM_ID,
  ExplorerAccessError,
  cleanSearch,
  fileKindLabel,
  type ExplorerFolder,
  type ExplorerItem,
} from '@/lib/files/explorer-types';
import { GraphError } from '@/lib/graph/client';
import { formatBytes } from '@/lib/files/types';
import { formatDateTime } from '@/lib/status';
import { log } from '@/lib/log';
import { Alert, Badge, Card, EmptyState, Input, PageHeader, buttonClass } from '@/components/ui';

export const metadata = { title: 'Files' };

type Params = { folder?: string; q?: string; connected?: string };

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-accent-500">
      <path
        fill="currentColor"
        d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.6 0 1.2.25 1.6.7L12 6h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"
      />
    </svg>
  );
}

function FileIcon({ label }: { label: string }) {
  const color =
    label === 'PDF'
      ? 'text-red-700'
      : label === 'Photo' || label === 'Image'
        ? 'text-sky-700'
        : label === 'Excel' || label === 'CSV'
          ? 'text-emerald-700'
          : label === 'Word'
            ? 'text-blue-700'
            : 'text-neutral-500';
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-6 w-6 shrink-0 ${color}`}>
      <path
        fill="currentColor"
        d="M6 2.5h7.6L19.5 8.4V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5m7 1.6V9h4.9z"
      />
    </svg>
  );
}

function folderHref(id: string, rootId: string) {
  return id === rootId ? '/admin/files' : `/admin/files?folder=${encodeURIComponent(id)}`;
}

function describeError(err: unknown): string {
  if (err instanceof ExplorerAccessError) {
    return 'That folder could not be found in the client folders. It may have been moved or deleted.';
  }
  if (err instanceof GraphError && err.status === 403) {
    return 'The portal does not have access to that SharePoint location.';
  }
  return 'SharePoint did not respond as expected. Please try again in a moment.';
}

export default async function FilesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const params = await searchParams;
  const source = await fileSource();

  if (!source) {
    return (
      <div>
        <PageHeader title="Files" description="Browse every client folder and file." />
        <EmptyState title="SharePoint is not connected yet">
          <p>Choose the folder that holds your client folders and they appear here.</p>
          <Link href="/admin/sharepoint" className={`${buttonClass('primary', 'sm')} mt-3`}>
            Connect SharePoint
          </Link>
        </EmptyState>
      </div>
    );
  }

  const folderId = params.folder && DRIVE_ITEM_ID.test(params.folder) ? params.folder : null;
  const q = cleanSearch(params.q);

  let folder: ExplorerFolder | null = null;
  let results: ExplorerItem[] | null = null;
  let error: string | null = null;
  try {
    folder = await source.listFolder(folderId);
    if (q) results = await source.search(folder.id, q);
  } catch (err) {
    if (!(err instanceof ExplorerAccessError)) {
      log.error('files.browse_failed', {
        reason: err instanceof GraphError ? err.code : (err as Error).name,
        statusCode: err instanceof GraphError ? err.status : 0,
      });
    }
    error = describeError(err);
  }

  // Link folders and files back to portal records: which client owns this folder, and
  // which files arrived through the portal.
  const db = serviceSupabase();
  const trailIds = folder?.trail.map((c) => c.id) ?? [];
  const shown = results ?? folder?.items ?? [];
  const fileIds = shown
    .filter((i) => i.kind === 'file')
    .map((i) => i.id)
    .slice(0, 200);
  const [{ data: owners }, { data: portalUploads }] =
    source.mode === 'sharepoint'
      ? await Promise.all([
          trailIds.length
            ? db
                .from('clients')
                .select('id, first_name, last_name, sharepoint_folder_id')
                .in('sharepoint_folder_id', trailIds)
            : Promise.resolve({ data: [] }),
          fileIds.length
            ? db
                .from('uploads')
                .select('sharepoint_item_id, client_id')
                .in('sharepoint_item_id', fileIds)
            : Promise.resolve({ data: [] }),
        ])
      : [{ data: [] }, { data: [] }];
  const owner = owners?.[0] ?? null;
  const fromPortal = new Set((portalUploads ?? []).map((u) => u.sharepoint_item_id));
  const sample = source.mode === 'sample';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Files"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>Every client folder and file, live from SharePoint.</span>
            {sample ? <Badge tone="amber">Sample data</Badge> : null}
          </span>
        }
        actions={
          <>
            {folder?.webUrl ? (
              <a
                href={folder.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('secondary', 'sm')}
              >
                Open in SharePoint ↗
              </a>
            ) : null}
            <Link
              href="/admin/sharepoint"
              className={buttonClass(sample ? 'primary' : 'ghost', 'sm')}
            >
              {sample ? 'Connect SharePoint' : 'SharePoint settings'}
            </Link>
          </>
        }
      />

      {params.connected && !sample ? (
        <Alert tone="success" title="SharePoint connected">
          These are the real client folders, read with the portal’s own app.
        </Alert>
      ) : null}
      {sample ? (
        <Alert tone="warning" title="Preview with sample folders">
          SharePoint is not connected yet, so these folders and files are made up. Nothing here is
          real and nothing can be downloaded.{' '}
          <Link href="/admin/sharepoint" className="font-medium underline">
            Connect SharePoint
          </Link>
        </Alert>
      ) : null}

      {folder ? (
        <nav aria-label="Folder path" className="overflow-x-auto">
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {folder.trail.map((crumb, i) => {
              const last = i === folder.trail.length - 1;
              return (
                <li key={crumb.id} className="flex items-center gap-1">
                  {i > 0 ? (
                    <span aria-hidden="true" className="text-neutral-400">
                      /
                    </span>
                  ) : null}
                  {last && !q ? (
                    <span aria-current="page" className="font-semibold text-brand-900">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      href={folderHref(crumb.id, source.rootId)}
                      className="rounded px-1 text-brand-700 hover:underline"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      {owner ? (
        <p className="text-sm text-neutral-700">
          Client:{' '}
          <Link
            href={`/admin/clients/${owner.id}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {owner.first_name} {owner.last_name}
          </Link>
        </p>
      ) : null}

      <form className="flex flex-col gap-2 sm:flex-row" role="search">
        {folder && folder.id !== source.rootId ? (
          <input type="hidden" name="folder" value={folder.id} />
        ) : null}
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder={
            folder && folder.id !== source.rootId
              ? `Search in ${folder.name}`
              : 'Search all client files'
          }
          aria-label="Search files"
          maxLength={100}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
        {q ? (
          <Link
            href={folder ? folderHref(folder.id, source.rootId) : '/admin/files'}
            className={buttonClass('ghost')}
          >
            Clear
          </Link>
        ) : null}
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {folder && !error ? (
        <Card className="p-0 sm:p-0">
          {q ? (
            <p className="border-b border-neutral-100 px-4 py-3 text-sm text-neutral-600">
              {shown.length === 0
                ? `No files or folders match “${q}”.`
                : `${shown.length}${shown.length >= 50 ? '+' : ''} match${shown.length === 1 ? '' : 'es'} for “${q}”.`}
            </p>
          ) : null}
          {shown.length === 0 && !q ? (
            <div className="p-4">
              <EmptyState title="This folder is empty" />
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {shown.map((item) => {
                const kind = item.kind === 'file' ? fileKindLabel(item.name, item.mime) : 'Folder';
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {item.kind === 'folder' ? <FolderIcon /> : <FileIcon label={kind} />}
                      <div className="min-w-0">
                        {item.kind === 'folder' ? (
                          <Link
                            href={folderHref(item.id, source.rootId)}
                            className="block truncate font-medium text-brand-900 hover:underline"
                          >
                            {item.name}
                          </Link>
                        ) : (
                          <p className="truncate font-medium text-neutral-900">{item.name}</p>
                        )}
                        <p className="text-xs text-neutral-500">
                          {item.kind === 'folder'
                            ? item.childCount !== null
                              ? `${item.childCount} item${item.childCount === 1 ? '' : 's'}`
                              : 'Folder'
                            : `${kind}${item.size !== null ? ` · ${formatBytes(item.size)}` : ''}`}
                          {item.modifiedAt ? ` · ${formatDateTime(item.modifiedAt)}` : ''}
                          {item.modifiedBy ? ` · ${item.modifiedBy}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 pl-9 sm:pl-0">
                      {fromPortal.has(item.id) ? <Badge tone="green">From portal</Badge> : null}
                      {q && item.parentId ? (
                        <Link
                          href={folderHref(item.parentId, source.rootId)}
                          className={buttonClass('ghost', 'sm')}
                        >
                          Show folder
                        </Link>
                      ) : null}
                      {item.kind === 'file' && !sample ? (
                        <a
                          href={`/api/admin/files/${encodeURIComponent(item.id)}/download`}
                          className={buttonClass('secondary', 'sm')}
                        >
                          Download
                        </a>
                      ) : null}
                      {item.webUrl ? (
                        <a
                          href={item.webUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonClass('ghost', 'sm')}
                          aria-label={`Open ${item.name} in SharePoint`}
                        >
                          Open ↗
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {folder.truncated ? (
            <p className="border-t border-neutral-100 px-4 py-3 text-sm text-neutral-600">
              Showing the first 1,000 items. Use search or open the folder in SharePoint to see the
              rest.
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
