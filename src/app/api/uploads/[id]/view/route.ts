import { NextResponse, type NextRequest } from 'next/server';
import { getClient } from '@/lib/auth/client';
import { UUID_RE } from '@/lib/actions';
import { fileSource } from '@/lib/files/source';
import { serviceSupabase } from '@/lib/supabase/admin';
import { ExplorerAccessError } from '@/lib/files/explorer-types';
import { GraphError } from '@/lib/graph/client';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';

/**
 * Lets a signed-in client open a file they (or someone approved for their client) sent.
 * Row level security confirms the upload is this client's own. The portal never
 * touches the file: it redirects the browser to SharePoint's own short-lived link for that
 * one file. The link is never logged or stored, and no folder is shared with anyone.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getClient();
  if (!ctx) return NextResponse.redirect(new URL('/login', request.url), 303);

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound(request);

  // Ownership through row level security, as the signed-in client.
  const { data: owned } = await ctx.supabase
    .from('uploads')
    .select('id, request_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!owned || owned.status !== 'complete') return notFound(request);

  // The SharePoint item ID is not readable by clients, so it is read server-side, again
  // limited to this client.
  const { data: upload } = await serviceSupabase()
    .from('uploads')
    .select('id, request_id, sharepoint_item_id')
    .eq('id', owned.id)
    .eq('client_id', ctx.client.id)
    .eq('status', 'complete')
    .maybeSingle();
  if (!upload?.sharepoint_item_id) return notFound(request);

  const source = await fileSource();
  if (!source) return unavailable(request, upload.request_id);

  let url: string | null;
  try {
    url = await source.downloadUrl(upload.sharepoint_item_id);
  } catch (err) {
    if (err instanceof ExplorerAccessError) return notFound(request);
    log.error('upload.view_failed', {
      uploadId: upload.id,
      reason: err instanceof GraphError ? err.code : (err as Error).name,
      statusCode: err instanceof GraphError ? err.status : 0,
    });
    return unavailable(request, upload.request_id);
  }
  if (!url) return notFound(request);

  await audit({
    actorType: 'client',
    actorId: ctx.user.id,
    action: 'upload.viewed',
    targetType: 'upload',
    targetId: upload.id,
    meta: metaFromHeaders(request.headers),
  });

  const res = NextResponse.redirect(url, 302);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function notFound(request: NextRequest) {
  return NextResponse.redirect(new URL('/?file=missing', request.url), 303);
}

function unavailable(request: NextRequest, requestId: string) {
  return NextResponse.redirect(new URL(`/request/${requestId}?file=unavailable`, request.url), 303);
}
