import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/auth/admin';
import { fileSource } from '@/lib/files/source';
import { DRIVE_ITEM_ID, ExplorerAccessError } from '@/lib/files/explorer-types';
import { GraphError } from '@/lib/graph/client';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';

/**
 * Admin-only download. The portal never touches the file: it checks the file sits inside
 * the client folders, records the download in the audit log, and redirects the browser to
 * SharePoint's own short-lived link. The link is never logged or stored.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!DRIVE_ITEM_ID.test(id)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const source = fileSource();
  if (!source) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let url: string | null;
  try {
    url = await source.downloadUrl(id);
  } catch (err) {
    if (err instanceof ExplorerAccessError)
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    log.error('files.download_failed', {
      reason: err instanceof GraphError ? err.code : (err as Error).name,
      statusCode: err instanceof GraphError ? err.status : 0,
    });
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
  if (!url) return NextResponse.json({ error: 'not_downloadable' }, { status: 404 });

  await audit({
    actorType: 'admin',
    actorId: admin.aid,
    action: 'file.downloaded',
    metadata: { item_id: id, source: source.mode },
    meta: metaFromHeaders(request.headers),
  });

  const res = NextResponse.redirect(url, 302);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
