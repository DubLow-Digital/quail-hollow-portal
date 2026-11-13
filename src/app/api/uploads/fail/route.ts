import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getClient } from '@/lib/auth/client';
import { assertSameOrigin } from '@/lib/security/origin';
import { serviceSupabase } from '@/lib/supabase/admin';
import { metaFromHeaders } from '@/lib/request-meta';
import { audit } from '@/lib/audit';

const bodySchema = z.object({
  uploadId: z.uuid(),
  reason: z.enum(['network', 'cancelled', 'session_expired', 'rejected', 'other']),
});

/** The browser reports an upload it could not finish, so it does not stay "in progress". */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ctx = await getClient();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const { data } = await serviceSupabase()
    .from('uploads')
    .update({ status: 'failed', failure_reason: `client_${parsed.data.reason}` })
    .eq('id', parsed.data.uploadId)
    .eq('client_id', ctx.client.id)
    .eq('status', 'pending')
    .select('id, request_id')
    .maybeSingle();

  if (data) {
    await audit({
      actorType: 'client',
      actorId: ctx.client.id,
      action: 'upload.failed',
      targetType: 'upload',
      targetId: data.id,
      metadata: { reason: parsed.data.reason, request_id: data.request_id },
      meta: metaFromHeaders(request.headers),
    });
  }
  return NextResponse.json({ ok: true });
}
