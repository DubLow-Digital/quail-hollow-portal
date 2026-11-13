import 'server-only';
import type { ActorType, Json } from '@/lib/db/types';
import { serviceSupabase } from '@/lib/supabase/admin';
import { log } from '@/lib/log';
import type { RequestMeta } from '@/lib/request-meta';

/**
 * Append-only audit trail. Records who did what to which record, by ID only. Metadata is
 * limited to short enum-like values so no personal data, codes or URLs end up here.
 */

export type AuditAction =
  | 'admin.login'
  | 'admin.login_denied'
  | 'admin.logout'
  | 'client.otp_requested'
  | 'client.otp_rate_limited'
  | 'client.login'
  | 'client.login_failed'
  | 'client.logout'
  | 'client.created'
  | 'client.updated'
  | 'client.archived'
  | 'client.restored'
  | 'client.invited'
  | 'client.folder_linked'
  | 'client.folder_created'
  | 'client.folder_unlinked'
  | 'request.created'
  | 'request.cancelled'
  | 'request.accepted'
  | 'request.redo'
  | 'upload.started'
  | 'upload.completed'
  | 'upload.failed'
  | 'upload.rejected'
  | 'document_type.created'
  | 'document_type.updated'
  | 'bundle.created'
  | 'bundle.updated'
  | 'bundle.deleted'
  | 'email.sent'
  | 'email.failed'
  | 'file.downloaded'
  | 'sync.pushed'
  | 'sync.push_failed'
  | 'sync.received'
  | 'sync.rejected'
  | 'client.imported'
  | 'settings.sharepoint_connected';

export type AuditTarget = 'client' | 'admin' | 'request' | 'upload' | 'document_type' | 'bundle';

type MetaValue = string | number | boolean | null;

export interface AuditEvent {
  actorType: ActorType;
  actorId: string | null;
  action: AuditAction;
  targetType?: AuditTarget | null;
  targetId?: string | null;
  metadata?: Record<string, MetaValue>;
  meta?: RequestMeta | null;
}

const SAFE_KEY = /^[a-z][a-z_]{0,39}$/;
const FORBIDDEN_KEY = /email|name|phone|ssn|token|code|url|secret|password|note/;

export function sanitizeMetadata(metadata: Record<string, MetaValue> = {}): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_KEY.test(key) || FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === 'string') {
      // Enum-like values, IDs and MIME types only; never URLs.
      if (!/^[A-Za-z0-9_.:/+-]{0,80}$/.test(value) || /^https?:/i.test(value)) continue;
      out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
}

/** Writes an audit record. Never throws: a logging failure must not break the user's action. */
export async function audit(event: AuditEvent): Promise<void> {
  try {
    const { error } = await serviceSupabase()
      .from('audit_log')
      .insert({
        actor_type: event.actorType,
        actor_id: event.actorId,
        action: event.action,
        target_type: event.targetType ?? null,
        target_id: event.targetId ?? null,
        metadata: sanitizeMetadata(event.metadata),
        ip: event.meta?.ip ?? null,
        user_agent: event.meta?.userAgent ?? null,
      });
    if (error) log.error('audit.insert_failed', { action: event.action, reason: error.code });
  } catch (err) {
    log.error('audit.insert_failed', { action: event.action, reason: (err as Error).name });
  }
}
