/**
 * Transactional email templates. Plain, professional language. Client emails never
 * mention the systems behind the portal, never include document contents, and link only
 * to the portal sign-in page.
 */

export const FIRM_NAME = 'Quail Hollow Accounting Services';
export const OFFICE_PHONE = '352-723-5062';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1c1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#1f4d3a;color:#ffffff;padding:18px 24px;font-size:16px;font-weight:600;">${FIRM_NAME}</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.5;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:13px;color:#555;">Questions? Call our office at ${OFFICE_PHONE}.<br>Please do not reply with documents by email. Use the secure portal instead.</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1f4d3a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

export interface RequestedItem {
  name: string;
  taxYear?: number | null;
  businessName?: string | null;
}

function itemLabel(item: RequestedItem): string {
  const parts = [item.name];
  if (item.taxYear) parts.push(`(${item.taxYear})`);
  if (item.businessName) parts.push(`for ${item.businessName}`);
  return parts.join(' ');
}

export function documentsRequestedEmail(input: {
  firstName: string;
  items: RequestedItem[];
  portalUrl: string;
  dueDate?: string | null;
  note?: string | null;
}): Rendered {
  const subject = 'Documents requested by Quail Hollow Accounting';
  const list = input.items.map((i) => `<li>${escapeHtml(itemLabel(i))}</li>`).join('');
  const due = input.dueDate
    ? `<p>Please send these by <strong>${escapeHtml(input.dueDate)}</strong>.</p>`
    : '';
  const note = input.note
    ? `<p style="background:#eef5f1;padding:12px;border-radius:8px;">${escapeHtml(input.note)}</p>`
    : '';
  const html = layout(
    subject,
    `<p>Hello ${escapeHtml(input.firstName)},</p>
<p>We need the following documents from you:</p>
<ul>${list}</ul>${due}${note}
<p>You can send them securely from your phone or computer. Take a photo, scan a few pages, or choose a file you already have.</p>
${button(input.portalUrl, 'Open your secure portal')}
<p style="font-size:14px;color:#555;">To sign in, enter this email address and we will send you a one-time code. No password needed.</p>
<p>Thank you,<br>${FIRM_NAME}</p>`,
  );
  const text = [
    `Hello ${input.firstName},`,
    '',
    'We need the following documents from you:',
    ...input.items.map((i) => `- ${itemLabel(i)}`),
    input.dueDate ? `\nPlease send these by ${input.dueDate}.` : '',
    input.note ? `\nNote: ${input.note}` : '',
    '',
    `Send them securely here: ${input.portalUrl}`,
    'To sign in, enter this email address and we will send you a one-time code.',
    '',
    `Thank you,\n${FIRM_NAME}\nQuestions? Call ${OFFICE_PHONE}.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { subject, html, text };
}

export function inviteEmail(input: {
  firstName: string;
  outstandingCount: number;
  portalUrl: string;
}): Rendered {
  const subject = 'Your secure document portal at Quail Hollow Accounting';
  const waiting =
    input.outstandingCount > 0
      ? `<p>You have <strong>${input.outstandingCount}</strong> document${input.outstandingCount === 1 ? '' : 's'} waiting to be sent.</p>`
      : '';
  const html = layout(
    subject,
    `<p>Hello ${escapeHtml(input.firstName)},</p>
<p>Quail Hollow Accounting uses a secure portal for your documents, so nothing sensitive has to travel by email.</p>${waiting}
${button(input.portalUrl, 'Open your secure portal')}
<p style="font-size:14px;color:#555;">To sign in, enter this email address and we will send you a one-time code. No password needed.</p>
<p>Thank you,<br>${FIRM_NAME}</p>`,
  );
  const text = [
    `Hello ${input.firstName},`,
    '',
    'Quail Hollow Accounting uses a secure portal for your documents, so nothing sensitive has to travel by email.',
    input.outstandingCount > 0
      ? `You have ${input.outstandingCount} document(s) waiting to be sent.`
      : '',
    '',
    `Open your portal: ${input.portalUrl}`,
    'To sign in, enter this email address and we will send you a one-time code.',
    '',
    `Thank you,\n${FIRM_NAME}\nQuestions? Call ${OFFICE_PHONE}.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { subject, html, text };
}

export function redoNeededEmail(input: {
  firstName: string;
  documentName: string;
  note: string;
  portalUrl: string;
}): Rendered {
  const subject = 'Please resend a document for Quail Hollow Accounting';
  const html = layout(
    subject,
    `<p>Hello ${escapeHtml(input.firstName)},</p>
<p>We need you to send <strong>${escapeHtml(input.documentName)}</strong> again.</p>
<p style="background:#fff4e5;padding:12px;border-radius:8px;">${escapeHtml(input.note)}</p>
${button(input.portalUrl, 'Resend in your secure portal')}
<p>Thank you,<br>${FIRM_NAME}</p>`,
  );
  const text = [
    `Hello ${input.firstName},`,
    '',
    `We need you to send ${input.documentName} again.`,
    `Reason: ${input.note}`,
    '',
    `Resend it here: ${input.portalUrl}`,
    '',
    `Thank you,\n${FIRM_NAME}\nQuestions? Call ${OFFICE_PHONE}.`,
  ].join('\n');
  return { subject, html, text };
}

export function newUploadEmail(input: {
  clientName: string;
  documentName: string;
  taxYear?: number | null;
  adminUrl: string;
}): Rendered {
  const doc = input.taxYear ? `${input.documentName} (${input.taxYear})` : input.documentName;
  const subject = `New upload: ${input.clientName}`;
  const html = layout(
    subject,
    `<p><strong>${escapeHtml(input.clientName)}</strong> uploaded <strong>${escapeHtml(doc)}</strong>.</p>
<p>It is saved in their client folder and waiting for your review.</p>
${button(input.adminUrl, 'Review in the portal')}`,
  );
  const text = `${input.clientName} uploaded ${doc}.\nIt is saved in their client folder and waiting for your review.\n\nReview: ${input.adminUrl}`;
  return { subject, html, text };
}
