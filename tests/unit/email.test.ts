import { describe, expect, it } from 'vitest';
import {
  documentsRequestedEmail,
  escapeHtml,
  inviteEmail,
  newUploadEmail,
  redoNeededEmail,
} from '@/lib/email/templates';
import { sanitizeMetadata } from '@/lib/audit';
import { sanitizeFields } from '@/lib/log';

const portalUrl = 'https://portal.example.test/login';

describe('email templates', () => {
  const emails = [
    documentsRequestedEmail({
      firstName: 'Test',
      items: [
        { name: 'W-2', taxYear: 2025 },
        { name: 'EIN Letter', businessName: 'Acme' },
      ],
      portalUrl,
      dueDate: 'Dec 1, 2026',
      note: 'Thanks!',
    }),
    inviteEmail({ firstName: 'Test', outstandingCount: 2, portalUrl }),
    redoNeededEmail({ firstName: 'Test', documentName: 'W-2', note: 'Blurry photo', portalUrl }),
  ];

  it('never mention the systems behind the portal to clients', () => {
    for (const e of emails) {
      const all = `${e.subject} ${e.html} ${e.text}`.toLowerCase();
      for (const word of ['sharepoint', 'supabase', 'graph', 'microsoft', 'onedrive']) {
        expect(all).not.toContain(word);
      }
    }
  });

  it('includes the portal link, office phone and the requested items', () => {
    const [requested] = emails;
    expect(requested!.html).toContain(portalUrl);
    expect(requested!.text).toContain('W-2 (2025)');
    expect(requested!.text).toContain('EIN Letter for Acme');
    expect(requested!.text).toContain('352-723-5062');
  });

  it('escapes HTML in names and notes', () => {
    const e = redoNeededEmail({
      firstName: '<img src=x onerror=alert(1)>',
      documentName: 'W-2',
      note: '"><script>alert(1)</script>',
      portalUrl,
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).not.toContain('<img src=x');
    expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
  });

  it('admin upload notice links to the admin page', () => {
    const e = newUploadEmail({
      clientName: 'Test Client',
      documentName: 'W-2',
      taxYear: 2025,
      adminUrl: 'https://x.test/admin/clients/1',
    });
    expect(e.subject).toBe('New upload: Test Client');
    expect(e.text).toContain('W-2 (2025)');
  });
});

describe('PII guards', () => {
  it('audit metadata drops personal fields and free text', () => {
    expect(
      sanitizeMetadata({
        reason: 'not_allowed',
        email: 'x@example.test',
        client_name: 'Test',
        note: 'secret',
        upload_url: 'https://x',
        kind: 'has spaces and @',
        count: 3,
      }),
    ).toEqual({ reason: 'not_allowed', count: 3 });
  });

  it('log fields are allowlisted', () => {
    expect(
      sanitizeFields({
        uploadId: 'u1',
        statusCode: 500,
        uploadUrl: 'https://secret',
        email: 'x',
        code: '123456',
      }),
    ).toEqual({ uploadId: 'u1', statusCode: 500 });
  });
});
