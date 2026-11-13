import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getClient } from '@/lib/auth/client';
import { assertSameOrigin } from '@/lib/security/origin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import { graphEnv } from '@/lib/env';
import { deleteItem, getChildByPath, getItem, type DriveItem } from '@/lib/graph/drive';
import { verifyUploadedItem } from '@/lib/uploads/verify';
import { notifyNewUpload } from '@/lib/requests/notify';

const bodySchema = z.object({
  uploadId: z.uuid(),
  /** Drive item ID from the final chunk response. Omitted when that response was lost. */
  itemId: z
    .string()
    .regex(/^[A-Za-z0-9!_.-]{1,200}$/)
    .optional(),
});

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * Step 5 of the upload flow: confirm the file really landed where we said, with the size
 * we expected, then mark the upload complete and the request uploaded, audit it, and
 * notify Aleida.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return fail(403, 'forbidden');
  const ctx = await getClient();
  if (!ctx) return fail(401, 'unauthorized');

  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail(400, 'invalid_request');
    input = parsed.data;
  } catch {
    return fail(400, 'invalid_request');
  }

  const db = serviceSupabase();
  const { data: upload } = await db
    .from('uploads')
    .select(
      'id, request_id, client_id, status, final_filename, target_folder_id, declared_size_bytes, page_count, started_at, document_requests(status, document_types(max_mb))',
    )
    .eq('id', input.uploadId)
    .eq('client_id', ctx.client.id)
    .maybeSingle();
  if (!upload) return fail(404, 'not_found');
  if (upload.status === 'complete') return NextResponse.json({ ok: true });
  if (upload.status !== 'pending') return fail(409, 'upload_closed');
  if (Date.now() - Date.parse(upload.started_at) > MAX_AGE_MS) return fail(409, 'upload_expired');

  const meta = metaFromHeaders(request.headers);
  const env = graphEnv();

  let item: DriveItem | null;
  try {
    item = input.itemId
      ? await getItem(input.itemId)
      : await getChildByPath(upload.target_folder_id, [upload.final_filename]);
  } catch (err) {
    log.error('upload.verify_unavailable', { uploadId: upload.id, reason: (err as Error).name });
    return fail(502, 'storage_unavailable');
  }

  const maxBytes = (upload.document_requests?.document_types?.max_mb ?? 0) * 1024 * 1024;
  const failure = item
    ? verifyUploadedItem(
        {
          id: item.id,
          name: item.name,
          size: item.size,
          isFile: Boolean(item.file),
          parentId: item.parentReference?.id,
          parentDriveId: item.parentReference?.driveId,
          createdDateTime: item.createdDateTime,
        },
        {
          finalFilename: upload.final_filename,
          targetFolderId: upload.target_folder_id,
          driveId: env.SP_DRIVE_ID,
          declaredSize: upload.declared_size_bytes,
          maxBytes,
          startedAt: upload.started_at,
        },
      )
    : 'not_found';

  if (failure) {
    // Remove a file we created that does not pass checks (never touch anything else).
    if (item && (failure === 'size_mismatch' || failure === 'too_large')) {
      await deleteItem(item.id).catch(() => undefined);
    }
    await db
      .from('uploads')
      .update({ status: 'failed', failure_reason: failure })
      .eq('id', upload.id);
    await audit({
      actorType: 'client',
      actorId: ctx.client.id,
      action: 'upload.rejected',
      targetType: 'upload',
      targetId: upload.id,
      metadata: { reason: failure, request_id: upload.request_id },
      meta,
    });
    return fail(422, 'verification_failed');
  }

  const now = new Date().toISOString();
  const { error: updateError } = await db
    .from('uploads')
    .update({
      status: 'complete',
      sharepoint_item_id: item!.id,
      sharepoint_web_url: item!.webUrl ?? null,
      size_bytes: item!.size ?? null,
      final_filename: item!.name,
      uploaded_at: now,
    })
    .eq('id', upload.id)
    .eq('status', 'pending');
  if (updateError) return fail(500, 'server_error');

  await db
    .from('document_requests')
    .update({ status: 'uploaded', status_changed_at: now })
    .eq('id', upload.request_id)
    .in('status', ['requested', 'redo', 'uploaded']);

  await audit({
    actorType: 'client',
    actorId: ctx.client.id,
    action: 'upload.completed',
    targetType: 'upload',
    targetId: upload.id,
    metadata: {
      request_id: upload.request_id,
      size_bytes: item!.size ?? null,
      page_count: upload.page_count,
    },
    meta,
  });

  // Email Aleida after the response so the client is not kept waiting.
  after(() => notifyNewUpload(upload.id));
  return NextResponse.json({ ok: true });
}
