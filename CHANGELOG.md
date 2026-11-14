# Change log

Every change to the Quail Hollow client portal, newest first. `main` deploys to production
(https://quail-hollow-portal.vercel.app) on merge, so each dated section is what went live that
day.

**How to add an entry:** every pull request adds a line under today's date (create the heading
if it is not there yet) in the group that fits: Added, Changed, Fixed, Removed, Security or
Operations. Write it for Todd and Aleida, not for developers, and end it with the pull request
link. CI fails a pull request that does not touch this file; a pull request with no visible
effect (for example a typo in a comment) can carry the `no-changelog` label instead.
Operations entries record setup changes outside the code (Vercel settings, Supabase, Microsoft
Entra) by name only, never their values.

## 2026-11-14

### Added

- This change log, and a CI check that every pull request updates it.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))

### Changed

- `docs/STATUS.md` brought up to date: Phase 1 is merged and live, and the remaining setup steps
  and open questions reflect what is actually configured in production.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- `docs/entra-setup.md` explains the AADSTS50105 sign-in error and who can assign users to the
  admin sign-in app. ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))

### Operations

- The sync service (quail-hollow-sync) no longer invites clients to SuiteDash. When a client
  becomes Active in Notion and is not in this portal yet, Aleida gets a Notion task to add and
  invite them here. ([quail-hollow-sync#5](https://github.com/DubLow-Digital/quail-hollow-sync/pull/5))
- Found while testing: Microsoft sign-in to `/admin` is refused (AADSTS50105) until Todd and
  Aleida are assigned to the "Quail Hollow Portal Admin Sign-in" enterprise app in Aleida's
  Microsoft 365. No code change; steps in `docs/entra-setup.md` step 6.

## 2026-11-13

Phase 1 merged and deployed to production.
([#1](https://github.com/DubLow-Digital/quail-hollow-portal/pull/1))

### Added

- Client sign-in with a one-time code by email (no passwords). Codes expire in 10 minutes,
  requests and attempts are rate limited per email and per IP, and sessions end after 30
  minutes idle or 12 hours.
- Client checklist: outstanding requests with due dates on top, completed below.
- Uploads per request: Take photo, Scan document (several pages combined into one PDF) and
  Choose file. Files go straight from the phone to the client's SharePoint folder in 5 MiB
  pieces; nothing passes through or is stored on the portal.
- Files are named by the portal (`JSmith_DriversLicense_2026-11-12.pdf`) and filed in the
  client's folder by document type; missing subfolders are created.
- Admin sign-in with Microsoft, limited to an allowlist.
- Admin: clients (create, edit, archive, search), link an existing SharePoint folder or create
  one in the standard structure, document type library, request bundles, assigning requests,
  accept or "needs redo" with a note, resend invite.
- Emails: "documents requested" and "redo needed" to clients, "new upload" to Aleida.
- Audit log of every sign-in, upload and admin action, with its own screen.
- Quail Hollow branding (palette, wordmark and nest mark), mobile-first layout.
- Files page (`/admin/files`): every client folder and file, live from SharePoint, with search,
  "From portal" badges, audited downloads and "Open in SharePoint". Shows labeled sample folders
  until SharePoint is connected.
- Notion and Lead Alchemist sync through quail-hollow-sync: clients added in the portal are
  created or linked in both, an Import screen brings clients in from either, and name and phone
  changes flow back. ([quail-hollow-sync#4](https://github.com/DubLow-Digital/quail-hollow-sync/pull/4))
- Connect SharePoint (`/admin/sharepoint`): choose the client-folders folder using the portal's
  own Microsoft app only, with the one-time site grant shown when the app cannot see the site.
- Backup admin sign-in by emailed code, for when Microsoft sign-in is unavailable. Controlled by
  `ADMIN_EMAIL_LOGIN`.

### Security

- Row level security on every table; clients can read only their own record and requests.
- Strict Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
  and a Permissions-Policy that allows the camera on the portal only.
- The portal's Microsoft app uses `Sites.Selected` (one SharePoint site only).
- No file contents, codes, upload links or tokens are logged or stored.
- `docs/security-summary.md` written for Aleida's WISP.

### Fixed

- After entering a correct code, a client could be sent back to the sign-in page. Sign-in now
  loads the next page fully, and rejected sessions are logged with a reason.
- The admin allowlist check no longer requires the Microsoft admin-app settings.

### Operations

- Vercel project `quail-hollow-portal` created (production branch `main`).
- Supabase connected through the Vercel integration; `supabase/update-2026-11-14.sql` run once
  in the SQL editor.
- Vercel settings added: `AUTH_SECRET` (separate preview and production values),
  `ADMIN_ALLOWLIST`, `APP_BASE_URL`, `MS_TENANT_ID`, `MS_PORTAL_CLIENT_ID`,
  `MS_PORTAL_CLIENT_SECRET`, `MS_ADMIN_CLIENT_ID`, `MS_ADMIN_CLIENT_SECRET`, `SP_SITE_ID`,
  `SP_DRIVE_ID`, `SP_CLIENT_ROOT_FOLDER_ID`, `SP_HOSTNAME`, `SYNC_HUB_URL`, `SYNC_HUB_SECRET`,
  `FILES_DEMO`, `ADMIN_EMAIL_LOGIN`.
- `todd@dub-low.consulting` added to `ADMIN_ALLOWLIST` during the Microsoft outage; remove it
  once Microsoft sign-in works.
- Not set yet: `RESEND_API_KEY` and `EMAIL_FROM`, so portal emails (invites, requests, redo,
  new upload) are not sent. Sign-in codes are unaffected.
