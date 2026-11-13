# Quail Hollow Client Portal: security summary

Prepared by DubLow Digital for Quail Hollow Accounting Services LLC's Written Information
Security Program (WISP) under the FTC Safeguards Rule (16 CFR Part 314). It describes how the
client portal protects customer information, what is stored where, and what Quail Hollow's
Qualified Individual should review. Last updated November 13, 2026 (Phase 1 build).

## 1. What the portal does

Clients sign in with a one-time code sent to their email, see the documents Quail Hollow has
requested, and send each one by photo, multi-page scan, or file. Files go directly from the
client's browser into that client's folder in Quail Hollow's own Microsoft 365 SharePoint.
Aleida (and DubLow for support) manage clients and requests from an admin area that requires a
Microsoft work account.

## 2. Where customer information lives

| Data                                                                          | Where                                     | Notes                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Uploaded documents (IDs, W-2s, returns, statements)                           | Quail Hollow's SharePoint (Microsoft 365) | Never stored on the portal's servers or database. Encrypted at rest by Microsoft.          |
| Client profile: name, email, phone, entity types, folder link                 | Supabase Postgres (US East)               | Encrypted at rest (AES-256) and in transit. No SSNs, account numbers or document contents. |
| Request records: document type, tax year, business name, notes, status, dates | Supabase Postgres                         | Staff are told not to put SSNs or account numbers in notes.                                |
| Upload records: final filename, size, type, page count, SharePoint item ID    | Supabase Postgres                         | Metadata only.                                                                             |
| Audit log: who did what, when, IP address, browser type                       | Supabase Postgres                         | IDs and event types only; append-only.                                                     |
| Sign-in codes                                                                 | Supabase Auth                             | Expire after 10 minutes; single use.                                                       |
| Secrets (API keys, app credentials)                                           | Vercel encrypted environment variables    | Never in source code.                                                                      |

## 3. How files travel

1. The client's browser asks the portal to start an upload. The portal checks the client's
   session, that the request belongs to them and is open, and that the file type and size are
   allowed for that document.
2. The portal decides the filename (for example `JSmith_W2_2025_2026-11-12.pdf`) and the folder.
   The client cannot choose either.
3. The portal asks Microsoft for a one-time upload link scoped to that single file and gives it
   to the browser. The link is never saved or logged.
4. The browser sends the file in encrypted chunks straight to SharePoint.
5. The portal confirms with Microsoft that the file arrived in the right folder with the
   expected size, then records it and notifies Aleida. Files that fail these checks are removed.

Photos are re-encoded in the browser before upload, which strips hidden metadata such as GPS
location from phone pictures.

## 4. Access control

- **Clients** sign in with a 6-digit code emailed to the address on file. Public sign-up is
  disabled; only Aleida can create a client. Each client can read only their own record, their
  own requests and their own uploads. This is enforced in the database itself (row level
  security) and covered by automated tests that prove a client cannot read another client's
  data. Clients cannot change any record directly.
- **Sessions** end after 30 minutes without activity or 12 hours in total, whichever comes first.
  The page also signs itself out after 30 idle minutes.
- **Admins** sign in with Microsoft (Aleida's Entra ID tenant). Access requires being on an
  explicit allowlist, and each allowed email is bound to one Microsoft account. Admin sessions
  end after 60 idle minutes or 12 hours.
- **Backup admin sign-in (off by default):** setting `ADMIN_EMAIL_LOGIN=true` lets allowlisted
  admins sign in with a one-time code emailed to their address, for use while Microsoft
  sign-in is unavailable. It is rate limited and audited (`method=email_code`), but it is a
  single factor, so it should be switched off in production once Microsoft sign-in (with MFA)
  is working.
- **SharePoint access** uses a dedicated app with the `Sites.Selected` permission, granted write
  access to one SharePoint site only. It cannot read or write any other site, mailbox or
  OneDrive. A verification script proves this.
- **Archiving** a client immediately blocks their sign-in and hides all of their requests.

## 5. Protection against common attacks

- Brute force: sign-in code requests and attempts are rate limited per email and per IP address.
  The sign-in screen gives the same response whether or not an email is registered.
- Web attacks: strict Content-Security-Policy with per-request nonces, HSTS, framing blocked
  (`X-Frame-Options: DENY`), no referrer leakage, camera allowed only on the portal itself,
  same-origin checks on every state-changing request, httpOnly session cookies.
- Input validation on every server input (Zod schemas). Filenames and folder names are cleaned
  of unsafe characters and cannot escape the client's folder.
- Dependencies are pinned to exact versions, and none were installed if published in the
  previous 14 days (guards against freshly compromised packages).

## 6. Logging and monitoring

- The audit log records every sign-in (success and failure), code request, upload start,
  completion and rejection, email sent, and admin action, with the actor, the record ID, the
  time, IP address and browser type. It cannot be edited or deleted through the application.
- Application logs contain only event names and record IDs. They never contain file contents,
  sign-in codes, upload links, tokens, SSNs or email addresses.
- Aleida can review the audit log at `/admin/audit`.

## 7. Service providers

| Provider                              | Role                            | Customer information they hold                         |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| Microsoft 365 (Quail Hollow's tenant) | Document storage, admin sign-in | Uploaded documents                                     |
| Supabase                              | Database and client sign-in     | Client profile, request and upload metadata, audit log |
| Vercel                                | Hosting                         | Transient request processing only; no file contents    |
| Resend                                | Transactional email             | Client name and email in notification emails           |
| DubLow Digital                        | Developer and IT provider       | Admin access for support, on the allowlist             |

Quail Hollow should keep each provider's security documentation (SOC 2 reports, DPAs) with the
WISP and review them annually.

## 8. Items for the Qualified Individual to decide or review

1. **MFA for staff:** require MFA for Aleida and DubLow on the admin sign-in app with an Entra
   Conditional Access policy (or Security Defaults). Recommended before go-live.
2. **Client sign-in strength:** clients use an emailed one-time code (possession of their email
   account). Decide whether this meets Quail Hollow's risk assessment for client access, or
   whether a second factor (for example an SMS code) should be added in a later phase.
3. **Retention:** how long upload metadata and audit logs are kept (open decision). Documents in
   SharePoint follow Quail Hollow's existing retention policy.
4. **Social Security cards:** whether to collect them as images or replace them later with a
   secure typed field.
5. **Access reviews:** review the admin allowlist and the Entra app assignments at least
   quarterly, and rotate the app secrets (or move to certificates) before expiry.
6. **Incident response:** add the portal to the WISP's incident response plan. To cut off access
   quickly: archive the client (blocks sign-in), remove an admin from `ADMIN_ALLOWLIST`, or
   disable the "Quail Hollow Client Portal" app in Entra (stops all uploads).

## 9. Testing performed

- 103 automated unit tests (filename rules, folder rules, file type checks, session limits,
  signed cookies, CSP, upload chunking and retry, PDF assembly, upload verification, email
  escaping, log and audit redaction).
- 33 database tests proving row level security against a real Postgres database.
- 28 browser tests on phone-sized screens (security headers, CSP, route protection, CSRF
  checks, sign-in form).
- Lighthouse mobile: performance 99, accessibility 100 on the sign-in pages.
- Still to do with real services: an end-to-end test on a Vercel preview with a test client and
  fake documents (milestone 10).
