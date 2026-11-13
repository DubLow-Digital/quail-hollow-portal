'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/admin';
import { audit } from '@/lib/audit';
import { str, type ActionState } from '@/lib/actions';
import { requestMeta } from '@/lib/request-meta';
import { LinkError, browseFolder, getSite, listLibraries } from '@/lib/graph/discover';
import { saveSharePointLocation } from '@/lib/graph/location';
import { SITE_ID, DRIVE_ID, ITEM_ID } from './ids';

/**
 * Saves the client-folders location. Everything is checked again with the portal's own app
 * (site exists, library belongs to it, folder is in the library) before it is stored.
 */
export async function connectSharePointAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const siteId = str(form, 'site');
  const driveId = str(form, 'drive');
  const folderId = str(form, 'folder');
  if (!SITE_ID.test(siteId) || !DRIVE_ID.test(driveId) || (folderId && !ITEM_ID.test(folderId))) {
    return { ok: false, message: 'Choose a folder first.' };
  }

  let saved: Awaited<ReturnType<typeof saveSharePointLocation>> | null = null;
  try {
    const site = await getSite(siteId);
    const library = (await listLibraries(siteId)).find((l) => l.id === driveId);
    if (!library) return { ok: false, message: 'That library is not on this site.' };
    const { folder, driveIdOk } = await browseFolder(driveId, folderId || null);
    if (!driveIdOk) return { ok: false, message: 'That folder is not in this library.' };
    saved = await saveSharePointLocation(
      {
        siteId: site.id,
        driveId: library.id,
        rootFolderId: folder.id,
        hostname: site.hostname,
        siteName: site.name,
        libraryName: library.name,
        folderPath: folderId ? `${library.name}/${folder.name}` : library.name,
        webUrl: folder.webUrl ?? library.webUrl,
      },
      admin.aid,
    );
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof LinkError ? err.message : 'SharePoint did not respond. Please try again.',
    };
  }
  if (!saved?.ok) {
    return {
      ok: false,
      message:
        saved?.reason === 'missing_table'
          ? 'The database needs a one-time update first: run supabase/update-2026-11-14.sql in the Supabase SQL editor, then try again.'
          : 'Could not save the location. Please try again.',
    };
  }

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'settings.sharepoint_connected',
    metadata: { via: 'portal' },
    meta: await requestMeta(),
  });
  redirect('/admin/files?connected=1');
}
