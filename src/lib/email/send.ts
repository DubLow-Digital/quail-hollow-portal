import 'server-only';
import { emailEnv } from '@/lib/env';
import { log } from '@/lib/log';

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Short enum-like tag used for logs and Resend tags, e.g. "documents_requested". */
  tag: string;
  idempotencyKey?: string;
}

/**
 * Sends a transactional email through Resend's REST API. Never throws: callers record the
 * outcome in the audit log. Recipient addresses and content are never logged.
 */
export async function sendEmail(message: EmailMessage): Promise<{ ok: boolean }> {
  let env;
  try {
    env = emailEnv();
  } catch {
    log.error('email.not_configured', { reason: message.tag });
    return { ok: false };
  }
  if (message.to.length === 0) return { ok: false };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: 'category', value: message.tag }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn('email.send_failed', { statusCode: res.status, reason: message.tag });
      return { ok: false };
    }
    log.info('email.sent', { reason: message.tag });
    return { ok: true };
  } catch (err) {
    log.warn('email.send_failed', { reason: (err as Error).name });
    return { ok: false };
  }
}

/** Where "new upload" notifications go: ADMIN_NOTIFY_EMAILS, else the first allowlisted admin. */
export function adminNotifyRecipients(): string[] {
  const env = emailEnv();
  const configured = (env.ADMIN_NOTIFY_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (configured.length) return configured;
  return env.ADMIN_ALLOWLIST.slice(0, 1);
}
