/**
 * Transactional email templates. Plain, professional language. Client emails never
 * mention the systems behind the portal, never include document contents, and link only
 * to the portal sign-in page.
 */

export const FIRM_NAME = 'Quail Hollow Accounting Services LLC';
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

/** The real Quail Hollow logo (served by the portal); a text header if no base URL is known. */
function emailLogo(serif: string): string {
  const base = (process.env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+$/i.test(base)) {
    return `<img src="${escapeHtml(base)}/brand/logo-email.png" width="280" height="82" alt="Quail Hollow Accounting Services LLC" style="display:block;border:0;width:280px;max-width:100%;height:auto;">`;
  }
  return `<div style="font-family:${serif};font-size:24px;letter-spacing:3px;text-transform:uppercase;color:#483829;">Quail Hollow</div>
<div style="font-family:${serif};font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#483829;margin-top:6px;">Accounting Services LLC</div>`;
}

function layout(title: string, bodyHtml: string): string {
  const serif = "Georgia,'Times New Roman',serif";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#faf7f2;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#2b241e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #ece2d2;">
<tr><td align="center" style="padding:22px 24px 16px;border-bottom:1px solid #c3ab7f;">
${emailLogo(serif)}
</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.5;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #ece2d2;font-size:13px;color:#6f5840;">Questions? Call our office at ${OFFICE_PHONE}.<br>Please do not reply with documents by email. Use the secure portal instead.</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#5b4734;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${escapeHtml(label)}</a></p>`;
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
    ? `<p style="background:#f6f1e9;padding:12px;border-radius:8px;">${escapeHtml(input.note)}</p>`
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
  /** Whose documents this is, when the person invited is not the client themselves. */
  accountName?: string | null;
  /** Who added them, when it was the client's main contact. */
  invitedBy?: string | null;
}): Rendered {
  const subject = 'Your secure document portal at Quail Hollow Accounting';
  const intro = input.accountName
    ? `${input.invitedBy ? `${escapeHtml(input.invitedBy)} added you` : 'You have been added'} to the secure document portal for <strong>${escapeHtml(input.accountName)}</strong> at Quail Hollow Accounting, so you can send documents on their behalf.`
    : 'Quail Hollow Accounting uses a secure portal for your documents, so nothing sensitive has to travel by email.';
  const introText = input.accountName
    ? `${input.invitedBy ? `${input.invitedBy} added you` : 'You have been added'} to the secure document portal for ${input.accountName} at Quail Hollow Accounting, so you can send documents on their behalf.`
    : 'Quail Hollow Accounting uses a secure portal for your documents, so nothing sensitive has to travel by email.';
  const waiting =
    input.outstandingCount > 0
      ? `<p>There ${input.outstandingCount === 1 ? 'is' : 'are'} <strong>${input.outstandingCount}</strong> document${input.outstandingCount === 1 ? '' : 's'} waiting to be sent.</p>`
      : '';
  const html = layout(
    subject,
    `<p>Hello ${escapeHtml(input.firstName)},</p>
<p>${intro}</p>${waiting}
${button(input.portalUrl, 'Open your secure portal')}
<p style="font-size:14px;color:#555;"><strong>How to sign in:</strong> if this email address is a Google or Microsoft account, choose <em>Continue with Google</em> or <em>Continue with Microsoft</em>. Otherwise choose <em>First time here?</em>: we email you a code, then you set up a passkey (Face ID, fingerprint or your phone) or a password with an authenticator app.</p>
<p>Thank you,<br>${FIRM_NAME}</p>`,
  );
  const text = [
    `Hello ${input.firstName},`,
    '',
    introText,
    input.outstandingCount > 0
      ? `There ${input.outstandingCount === 1 ? 'is' : 'are'} ${input.outstandingCount} document(s) waiting to be sent.`
      : '',
    '',
    `Open your portal: ${input.portalUrl}`,
    'How to sign in: if this email address is a Google or Microsoft account, choose Continue with Google or Continue with Microsoft. Otherwise choose "First time here?": we email you a code, then you set up a passkey or a password with an authenticator app.',
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
