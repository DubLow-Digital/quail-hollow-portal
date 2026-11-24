import 'server-only';
import { z } from 'zod';
import { syncConfigured } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { log } from '@/lib/log';
import { HubError, hubPost } from './hub';

/**
 * When every document request for a client is Accepted, tells quail-hollow-sync once
 * ("intake complete"), which moves the client to Portal Intake Complete in Notion and Lead
 * Alchemist. Only the Notion page ID is sent: never documents, names or request details.
 * "Once" is recorded in the audit log (action sync.intake_complete). Never throws.
 */
const responseSchema = z.object({ ok: z.literal(true), result: z.string().max(40) });

export type IntakeCompleteResult =
  'sent' | 'not_configured' | 'not_linked' | 'open_requests' | 'already_sent' | 'error';

export async function notifyIntakeCompleteIfDone(clientId: string): Promise<IntakeCompleteResult> {
  if (!syncConfigured()) return 'not_configured';
  const db = serviceSupabase();
  try {
    const { data: client } = await db
      .from('clients')
      .select('id, notion_page_id')
      .eq('id', clientId)
      .maybeSingle();
    if (!client?.notion_page_id) return 'not_linked';

    const { data: requests, error } = await db
      .from('document_requests')
      .select('status')
      .eq('client_id', clientId);
    if (error) return 'error';
    if (!requests?.length || requests.some((r) => r.status !== 'accepted')) return 'open_requests';

    const { count } = await db
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'sync.intake_complete')
      .eq('target_id', clientId);
    if ((count ?? 0) > 0) return 'already_sent';

    const r = await hubPost(
      '/api/portal/intake-complete',
      { client: { notion_page_id: client.notion_page_id } },
      responseSchema,
    );
    await audit({
      actorType: 'system',
      actorId: null,
      action: 'sync.intake_complete',
      targetType: 'client',
      targetId: clientId,
      metadata: { result: r.result },
    });
    return 'sent';
  } catch (err) {
    log.error('sync.intake_complete_failed', {
      clientId,
      reason: err instanceof HubError ? err.code : (err as Error).name,
      statusCode: err instanceof HubError ? err.status : 0,
    });
    return 'error';
  }
}
