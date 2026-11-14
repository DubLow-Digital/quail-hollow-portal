# Quail Hollow Client Portal — Phase 1 Build Brief (for Claude Code)

Owner: Todd Whitelow, DubLow Digital (todd@dublowdigital.com)
Client: Quail Hollow Accounting Services LLC (Ocala, FL), owner Aleida Buckner (aleida@quailhollowaccounting.com)
Repo: `DubLow-Digital/quail-hollow-portal` (new, private)
Hosting: Vercel (DubLow team)

Save this file in the repo root as `CLAUDE.md` so it stays loaded as project context.

---

## 1. What we are building

A custom, mobile-first client portal that sits on top of Aleida's SharePoint. Clients never see SharePoint and never need a Microsoft account. They log in with a one-time code, see a checklist of documents Aleida has requested, and upload each one by taking a photo, scanning with the camera, or picking a file. Every upload is renamed to Quail Hollow's naming convention and written directly into that client's SharePoint folder through a scoped Entra app.

Aleida has an admin side where she creates clients, links or creates each client's SharePoint folder, assigns document requests, and sees what has been received.

## 2. Phase 1 scope

In scope:
- Client login with email one-time code (no passwords)
- Admin login for Aleida (and Todd) with Microsoft sign-in, restricted to an allowlist
- Admin: client list, create/edit client, link an existing SharePoint folder or create a new one in the standard structure
- Admin: document type library (name, description, naming rule, target subfolder, accepted file types, max size)
- Admin: assign document requests to a client (single or from a preset bundle, e.g. "New individual tax client")
- Client dashboard: checklist of outstanding and completed requests
- Upload per request: Take photo (rear camera), Scan document (multi-page photos combined into one PDF), Choose file
- Server-side renaming per naming rule; upload straight to SharePoint via Graph upload sessions
- Status tracking: Requested → Uploaded → Accepted / Needs redo (admin can mark redo with a note)
- Email notifications: client gets "documents requested" and "redo needed"; Aleida gets "new upload"
- Full audit log of logins, uploads, status changes and admin actions

Out of scope for Phase 1 (do not build yet): locked fillable forms such as the check roster, delivering finished documents from Aleida to clients, Notion sync, QuickBooks, Lead Alchemist sync, e-signature, payments.

## 3. Stack

- Next.js (App Router, TypeScript, latest stable), Tailwind CSS
- Supabase: Postgres + Auth (email OTP for clients) + Row Level Security
- Microsoft Graph via `@azure/msal-node` (client credentials) for SharePoint; Auth.js or MSAL for admin Microsoft sign-in
- Resend for transactional email (also configured as Supabase Auth custom SMTP so login codes come from a Quail Hollow sender)
- `pdf-lib` for combining scanned photos into a PDF in the browser
- Zod for all input validation
- Vercel for hosting; Vercel environment variables for all secrets

## 4. Security requirements (non-negotiable)

Quail Hollow is a tax preparer and falls under the FTC Safeguards Rule. These rules apply to every piece of code:

1. File bytes never pass through or rest on our servers or database. Browser uploads go directly to the Graph upload session URL. The database stores metadata only.
2. The Entra app uses `Sites.Selected` and is granted write access to Aleida's one SharePoint site only. Never request `Sites.ReadWrite.All` or `Files.ReadWrite.All`.
3. The client never chooses the final filename or folder. The server builds the path from the request record and returns a one-time upload URL.
4. Every table has RLS. Clients can only read their own client record and their own requests. All admin operations run server-side with the service role after an admin check.
5. Never log file contents, SSNs, upload URLs, tokens or codes. Log IDs and event types only.
6. Login codes expire in 10 minutes; rate-limit code requests and verify attempts per email and per IP.
7. Client sessions expire after 30 minutes idle and 12 hours absolute.
8. Validate MIME type and extension against the document type, and enforce max size, before creating an upload session. After upload, confirm the item via Graph and record the returned item ID and size.
9. Security headers: strict CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` allowing camera on our origin only.
10. No real client data in seeds, tests, screenshots or fixtures. Use obviously fake names.
11. Secrets live only in Vercel env vars and a local `.env.local` that is gitignored. Commit a `.env.example` with names only.

## 5. Entra app and SharePoint setup (Todd does this manually; Claude Code writes the script and the runbook)

Claude Code: produce `docs/entra-setup.md` with these steps and `scripts/grant-site-permission.ts` to perform step 5.

1. In Aleida's Microsoft 365 tenant (Entra admin center), create an app registration named `Quail Hollow Client Portal`, single tenant.
2. API permissions → Microsoft Graph → Application permissions → add `Sites.Selected`. Grant admin consent.
3. Create a client secret (or certificate, preferred for production) and record Tenant ID, Client ID and secret in Vercel env vars.
4. Identify the target SharePoint site and document library that holds client folders. Get the site ID via `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}` and the drive ID via `GET /sites/{site-id}/drives`.
5. Grant the portal app write access to that one site: `POST /sites/{site-id}/permissions` with body `{ "roles": ["write"], "grantedToIdentities": [{ "application": { "id": "<portal-client-id>", "displayName": "Quail Hollow Client Portal" } }] }`. This call must be made by an identity holding `Sites.FullControl.All` (a temporary admin app or Graph Explorer as Global Admin). Remove that temporary access afterward.
6. For admin sign-in, create a second app registration `Quail Hollow Portal Admin Sign-in` (delegated `openid profile email User.Read`), redirect URI `https://<portal-domain>/api/auth/callback/microsoft-entra-id`.
7. Verify with `scripts/check-graph-access.ts`: list root folders of the client drive and create/delete a test folder named `_portal-access-test`.

## 6. Data model (Supabase)

`admins` — id, email (unique), display_name, created_at
`clients` — id, first_name, last_name, email (unique), phone, entity_types (text[]: individual, schedule_c, 1120s, 1065, other), status (invited, active, archived), sharepoint_drive_id, sharepoint_folder_id, sharepoint_folder_path, auth_user_id (Supabase auth), created_at, updated_at
`document_types` — id, name, description, slug_for_filename (e.g. `DriversLicense`), naming_template, target_subfolder (e.g. `ID`, `Tax Returns/{year}`), accepted_mime (text[]), max_mb, requires_year (bool), active, sort_order
`request_bundles` — id, name; `request_bundle_items` — bundle_id, document_type_id
`document_requests` — id, client_id, document_type_id, tax_year (nullable), note_to_client, status (requested, uploaded, accepted, redo), requested_by, requested_at, due_date (nullable)
`uploads` — id, request_id, client_id, final_filename, sharepoint_item_id, sharepoint_web_url (admin only), size_bytes, mime, page_count, uploaded_at, status (pending, complete, failed)
`audit_log` — id, actor_type (client, admin, system), actor_id, action, target_type, target_id, ip, user_agent, created_at (no PII beyond IDs)

Seed `document_types` with: Driver's License (front/back), Social Security Card, Prior-Year Federal Tax Return, Prior-Year State Tax Return, W-2, 1099 (any), Bank Statement, Business Formation Documents, EIN Letter, W-9, Prior-Year Business Return. Seed one bundle "New individual tax client" and one "New business client".

## 7. Naming convention

Default template: `{FirstInitial}{LastName}_{DocSlug}[_{TaxYear}]_{YYYY-MM-DD}.{ext}`
Example: `JSmith_DriversLicense_2026-11-12.pdf`, `JSmith_FederalReturn_2025_2026-11-12.pdf`

Rules: strip anything outside letters, digits, hyphen and underscore; title-case last name; if a file with the same name exists, Graph `conflictBehavior: rename` handles it. Make the template configurable per document type. Unit-test the name builder.

## 8. Folder structure and linking

Standard structure created by "Create folder" (matches how Aleida organizes by person, then businesses, then year):
```
{Client folder root}/
  {LastName}, {FirstName}/
    Individual/
      ID/
      Tax Returns/{year}/
      Income Documents/{year}/
    Businesses/
      {Business name}/{year}/
    Dependents/
```
Admin "Link existing folder" opens a folder browser that lists child folders from the client drive via Graph (lazy-loaded tree, search by name). Selecting one stores `sharepoint_folder_id` and path on the client. Upload paths resolve as `{client folder}/{document_type.target_subfolder}` and missing subfolders are created on demand.

## 9. Upload flow (exact sequence)

1. Client taps a request → chooses Take photo, Scan document or Choose file.
2. Take photo: `<input type="file" accept="image/*" capture="environment">`. Scan document: in-app camera view via `getUserMedia` (rear camera), capture one or more pages, preview/retake, combine into one PDF with `pdf-lib`, compress images to ~1600px long edge. Choose file: standard picker filtered to accepted types.
3. Browser calls `POST /api/uploads/start` with request ID, MIME, size, page count. Server checks session, ownership, request status, type and size, builds the final name and folder path, ensures folders exist, calls Graph `POST /drives/{drive-id}/items/{parent-id}:/{filename}:/createUploadSession` with `conflictBehavior: rename`, inserts `uploads` row as pending, returns the upload URL.
4. Browser uploads in chunks (multiples of 320 KiB, ~5 MiB chunks) directly to the upload URL with progress UI and retry on failure.
5. Browser calls `POST /api/uploads/complete`. Server verifies the item via Graph, stores item ID and size, sets upload complete and request uploaded, writes audit log, emails Aleida.
6. Client sees a success state; the checklist item turns green.

Phase 1b (after core works): automatic page edge detection and perspective crop in Scan mode using `jscanify` (OpenCV.js), loaded only on the scan screen.

## 10. Screens

Client (mobile-first, large tap targets, plain language, Quail Hollow branding):
- `/login` email → code entry
- `/` checklist: outstanding requests on top with due dates, completed below
- `/request/[id]` three big buttons (Take photo, Scan document, Choose file), preview, upload progress, success
- Help text and Aleida's office line 352-723-5062 in the footer

Admin:
- `/admin` dashboard: recent uploads, clients with outstanding requests
- `/admin/clients` list + search; `/admin/clients/new`; `/admin/clients/[id]` profile, folder link/create, requests, uploads (with "Open in SharePoint" link), mark accepted / redo with note, resend invite
- `/admin/document-types` library CRUD; `/admin/bundles`
- `/admin/audit` filterable audit log

## 11. Environment variables (`.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MS_TENANT_ID=
MS_PORTAL_CLIENT_ID=
MS_PORTAL_CLIENT_SECRET=
MS_ADMIN_CLIENT_ID=
MS_ADMIN_CLIENT_SECRET=
SP_SITE_ID=
SP_DRIVE_ID=
SP_CLIENT_ROOT_FOLDER_ID=
ADMIN_ALLOWLIST=aleida@quailhollowaccounting.com,todd@dublowdigital.com
RESEND_API_KEY=
EMAIL_FROM=
APP_BASE_URL=
AUTH_SECRET=
```

## 12. Build order (one PR per milestone)

1. Scaffold: Next.js + Tailwind + Supabase client, lint/format, security headers, `.env.example`, README, CI (typecheck, lint, tests) on GitHub Actions.
2. Database migrations, RLS policies, seed data; RLS tests proving a client cannot read another client's rows.
3. Graph service module (token cache, get folder children, create folder, create upload session, get item) plus `docs/entra-setup.md`, `scripts/grant-site-permission.ts`, `scripts/check-graph-access.ts`.
4. Admin sign-in with allowlist; admin client CRUD; folder browser and link/create.
5. Document types, bundles, assigning requests; invite email.
6. Client OTP login, rate limits, session timeouts; checklist screen.
7. Upload flow (photo, file, multi-page scan to PDF), naming, direct chunked upload, completion verification, notifications.
8. Accept / redo workflow, audit log screen.
9. Hardening pass: CSP review, error states, offline/retry, accessibility, Lighthouse mobile score 90+, `docs/security-summary.md` written for Aleida's WISP.
10. Deploy to Vercel preview; Todd tests on iPhone and Android with fake client data.

## 13. Acceptance criteria for Phase 1

- A test client receives an invite, logs in with a code on a phone, and sees exactly the requests assigned to them.
- Taking a photo of a fake driver's license results in `TTest_DriversLicense_<date>.jpg` (or `.pdf` from Scan) in that client's `ID` subfolder in SharePoint within seconds, and Aleida gets an email.
- A three-page scan arrives as one PDF.
- A 40 MB PDF uploads successfully on a phone connection.
- A client cannot see or upload to another client's requests (verified by test).
- The Entra app cannot list any SharePoint site other than the granted one (verified by script).
- No file bytes, codes or upload URLs appear in Vercel logs or Supabase tables.
- Every login, upload and admin action appears in the audit log.

## 14. Working rules for Claude Code

- Work on feature branches, open a PR per milestone with a short summary and test notes; do not push to `main` directly.
- Ask Todd before: creating cloud resources, adding paid services, changing auth design, or touching Aleida's tenant.
- Write tests alongside code (Vitest for units, Playwright for the upload and RLS flows).
- Keep dependencies minimal and pinned; no package published in the last 14 days.
- Client-facing copy is plain, professional and confident. Never mention SharePoint, Supabase or Graph to clients.
- When a milestone is done, update `docs/STATUS.md` with what shipped, what's next, and open questions.
- Every pull request adds an entry to `CHANGELOG.md` under today's date (Added, Changed, Fixed, Removed, Security or Operations), written plainly and ending with the PR link. Record setup changes made outside the code (Vercel settings, Supabase, Entra) as Operations entries, by name only. CI fails a PR that skips it unless it carries the `no-changelog` label.
- After a merge that changes what Aleida or her clients see, also update the Quail Hollow HQ master file in SharePoint (Second Brain, `00-Quail-Hollow-HQ.md`): its Change log section, and Snapshot or Active work if they changed. If this session cannot reach SharePoint, say so to Todd instead of skipping it silently.

## 15. Open decisions (flag to Todd, do not guess)

- Portal domain: `portal.quailhollowaccounting.com` currently points to SuiteDash. Proposed `secure.quailhollowaccounting.com` until the portal choice is final.
- Which SharePoint site and library holds client folders, and whether existing folders get linked or re-created in the standard structure.
- Whether Social Security cards are collected as images or replaced by a secure typed field later.
- Retention: how long `uploads` metadata and audit logs are kept.
