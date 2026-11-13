import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getClient } from '@/lib/auth/client';
import { assertSameOrigin } from '@/lib/security/origin';
import { hitLimit, LIMITS } from '@/lib/security/rate-limit';
import { serviceSupabase } from '@/lib/supabase/admin';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import { graphEnv } from '@/lib/env';
import { MAX_PAGE_COUNT, canonicalExtension, checkFileAgainstRules } from '@/lib/files/types';
import { NamingTemplateError, buildFilename } from '@/lib/naming/filename';
import { FolderPathError, resolveSubfolder } from '@/lib/naming/folders';
import { createUploadSession, ensureFolderPath } from '@/lib/graph/drive';
import { DEFAULT_CHUNK_SIZE } from '@/lib/upload/chunked-upload';

const bodySchema = z.object({
  requestId: z.uuid(),
  mime: z.string().trim().toLowerCase().max(100),
  size: z
    .number()
    .int()
    .positive()
    .max(250 * 1024 * 1024),
  pageCount: z.number().int().min(1).max(MAX_PAGE_COUNT).optional(),
  captureMethod: z.enum(['photo', 'scan', 'file']),
  originalName: z.string().max(255).optional(),
});

const UPLOADABLE = new Set(['requested', 'redo', 'uploaded']);

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * Step 3 of the upload flow. The server decides the filename and folder from the request
 * record, validates the file against the document type, makes sure the folder exists, and
 * returns a one-time Graph upload URL. The client never chooses the name or location.
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

  if (!(await hitLimit(LIMITS.uploadStartPerClient, ctx.client.id)))
    return fail(429, 'rate_limited');

  // Ownership: read the request through RLS as the signed-in client.
  const { data: req } = await ctx.supabase
    .from('document_requests')
    .select('id, client_id, status, document_type_id, tax_year, business_name')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!req || req.client_id !== ctx.client.id) return fail(404, 'not_found');
  if (!UPLOADABLE.has(req.status)) return fail(409, 'request_closed');

  const db = serviceSupabase();
  const [{ data: type }, { data: client }] = await Promise.all([
    db
      .from('document_types')
      .select('slug_for_filename, naming_template, target_subfolder, accepted_mime, max_mb')
      .eq('id', req.document_type_id)
      .maybeSingle(),
    db
      .from('clients')
      .select(
        'first_name, last_name, sharepoint_folder_id, sharepoint_folder_path, sharepoint_drive_id',
      )
      .eq('id', ctx.client.id)
      .maybeSingle(),
  ]);
  if (!type || !client) return fail(404, 'not_found');
  if (!client.sharepoint_folder_id || client.sharepoint_drive_id !== graphEnv().SP_DRIVE_ID) {
    return fail(409, 'not_ready');
  }

  if (input.captureMethod === 'scan' && input.mime !== 'application/pdf')
    return fail(400, 'type_not_allowed');
  const fileError = checkFileAgainstRules(
    {
      mime: input.mime,
      sizeBytes: input.size,
      originalName: input.originalName,
      pageCount: input.pageCount,
    },
    { acceptedMime: type.accepted_mime, maxMb: type.max_mb },
  );
  if (fileError) return fail(400, fileError);

  let filename: string;
  let segments: string[];
  try {
    filename = buildFilename(type.naming_template, {
      firstName: client.first_name,
      lastName: client.last_name,
      docSlug: type.slug_for_filename,
      taxYear: req.tax_year,
      businessName: req.business_name,
      extension: canonicalExtension(input.mime),
      date: new Date(),
    });
    segments = resolveSubfolder(type.target_subfolder, {
      taxYear: req.tax_year,
      businessName: req.business_name,
    });
  } catch (err) {
    if (err instanceof NamingTemplateError || err instanceof FolderPathError) {
      log.error('upload.config_error', { requestId: req.id, reason: err.name });
      return fail(409, 'not_ready');
    }
    throw err;
  }

  let folderId: string;
  let uploadUrl: string;
  let expiresAt: string;
  try {
    const folder = await ensureFolderPath(client.sharepoint_folder_id, segments);
    folderId = folder.id;
    const session = await createUploadSession(folderId, filename, input.size);
    uploadUrl = session.uploadUrl;
    expiresAt = session.expirationDateTime;
  } catch (err) {
    log.error('upload.session_failed', { requestId: req.id, reason: (err as Error).name });
    return fail(502, 'storage_unavailable');
  }

  const { data: upload, error } = await db
    .from('uploads')
    .insert({
      request_id: req.id,
      client_id: ctx.client.id,
      final_filename: filename,
      target_folder_id: folderId,
      target_folder_path: [client.sharepoint_folder_path ?? '', ...segments]
        .filter(Boolean)
        .join('/'),
      declared_size_bytes: input.size,
      mime: input.mime,
      page_count: input.pageCount ?? null,
      capture_method: input.captureMethod,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !upload) {
    log.error('upload.insert_failed', { requestId: req.id, reason: error?.code ?? 'unknown' });
    return fail(500, 'server_error');
  }

  await audit({
    actorType: 'client',
    actorId: ctx.client.id,
    action: 'upload.started',
    targetType: 'upload',
    targetId: upload.id,
    metadata: {
      request_id: req.id,
      mime: input.mime,
      size_bytes: input.size,
      page_count: input.pageCount ?? null,
      capture: input.captureMethod,
    },
    meta: metaFromHeaders(request.headers),
  });

  // The upload URL goes to this browser only. It is never stored or logged.
  return NextResponse.json({
    uploadId: upload.id,
    uploadUrl,
    expiresAt,
    chunkSize: DEFAULT_CHUNK_SIZE,
  });
}
