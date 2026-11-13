import 'server-only';
import { appEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { adminNotifyRecipients, sendEmail } from '@/lib/email/send';
import {
  documentsRequestedEmail,
  inviteEmail,
  newUploadEmail,
  redoNeededEmail,
} from '@/lib/email/templates';
import { serviceSupabase } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/status';
import type { ActorType } from '@/lib/db/types';

/**
 * Notification emails. Each send is recorded in the audit log (email.sent / email.failed)
 * against the client or request it concerns, by ID only.
 */

interface Actor {
  actorType: ActorType;
  actorId: string | null;
}

function portalUrl(): string {
  return `${appEnv().APP_BASE_URL}/login`;
}

async function record(
  actor: Actor,
  ok: boolean,
  kind: string,
  targetType: 'client' | 'request' | 'upload',
  targetId: string,
) {
  await audit({
    ...actor,
    action: ok ? 'email.sent' : 'email.failed',
    targetType,
    targetId,
    metadata: { kind },
  });
}

export async function notifyDocumentsRequested(
  actor: Actor,
  clientId: string,
  requestIds: string[],
  options: { note?: string | null; dueDate?: string | null } = {},
): Promise<boolean> {
  const db = serviceSupabase();
  const [{ data: client }, { data: requests }] = await Promise.all([
    db
      .from('clients')
      .select('id, first_name, email, status, invited_at')
      .eq('id', clientId)
      .maybeSingle(),
    db
      .from('document_requests')
      .select('tax_year, business_name, document_types(name, sort_order)')
      .in('id', requestIds),
  ]);
  if (!client || client.status === 'archived' || !requests?.length) return false;

  const items = requests
    .sort((a, b) => (a.document_types?.sort_order ?? 0) - (b.document_types?.sort_order ?? 0))
    .map((r) => ({
      name: r.document_types?.name ?? 'Document',
      taxYear: r.tax_year,
      businessName: r.business_name,
    }));
  const email = documentsRequestedEmail({
    firstName: client.first_name,
    items,
    portalUrl: portalUrl(),
    dueDate: options.dueDate ? formatDate(options.dueDate) : null,
    note: options.note ?? null,
  });
  const { ok } = await sendEmail({ to: [client.email], ...email, tag: 'documents_requested' });
  if (ok && !client.invited_at) {
    await db.from('clients').update({ invited_at: new Date().toISOString() }).eq('id', clientId);
  }
  await record(actor, ok, 'documents_requested', 'client', clientId);
  return ok;
}

export async function notifyInvite(actor: Actor, clientId: string): Promise<boolean> {
  const db = serviceSupabase();
  const [{ data: client }, { count }] = await Promise.all([
    db.from('clients').select('id, first_name, email, status').eq('id', clientId).maybeSingle(),
    db
      .from('document_requests')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['requested', 'redo']),
  ]);
  if (!client || client.status === 'archived') return false;
  const email = inviteEmail({
    firstName: client.first_name,
    outstandingCount: count ?? 0,
    portalUrl: portalUrl(),
  });
  const { ok } = await sendEmail({ to: [client.email], ...email, tag: 'invite' });
  if (ok)
    await db.from('clients').update({ invited_at: new Date().toISOString() }).eq('id', clientId);
  await record(actor, ok, 'invite', 'client', clientId);
  return ok;
}

export async function notifyRedo(actor: Actor, requestId: string): Promise<boolean> {
  const { data: request } = await serviceSupabase()
    .from('document_requests')
    .select('id, redo_note, tax_year, clients(first_name, email, status), document_types(name)')
    .eq('id', requestId)
    .maybeSingle();
  if (!request?.clients || request.clients.status === 'archived' || !request.redo_note)
    return false;
  const name = request.document_types?.name ?? 'a document';
  const email = redoNeededEmail({
    firstName: request.clients.first_name,
    documentName: request.tax_year ? `${name} (${request.tax_year})` : name,
    note: request.redo_note,
    portalUrl: portalUrl(),
  });
  const { ok } = await sendEmail({ to: [request.clients.email], ...email, tag: 'redo_needed' });
  await record(actor, ok, 'redo_needed', 'request', requestId);
  return ok;
}

export async function notifyNewUpload(uploadId: string): Promise<boolean> {
  const { data: upload } = await serviceSupabase()
    .from('uploads')
    .select(
      'id, client_id, clients(first_name, last_name), document_requests(tax_year, document_types(name))',
    )
    .eq('id', uploadId)
    .maybeSingle();
  if (!upload?.clients) return false;
  let recipients: string[];
  try {
    recipients = adminNotifyRecipients();
  } catch {
    return false;
  }
  const email = newUploadEmail({
    clientName: `${upload.clients.first_name} ${upload.clients.last_name}`,
    documentName: upload.document_requests?.document_types?.name ?? 'a document',
    taxYear: upload.document_requests?.tax_year ?? null,
    adminUrl: `${appEnv().APP_BASE_URL}/admin/clients/${upload.client_id}`,
  });
  const { ok } = await sendEmail({
    to: recipients,
    ...email,
    tag: 'new_upload',
    idempotencyKey: `upload-${uploadId}`,
  });
  await record({ actorType: 'system', actorId: null }, ok, 'new_upload', 'upload', uploadId);
  return ok;
}
