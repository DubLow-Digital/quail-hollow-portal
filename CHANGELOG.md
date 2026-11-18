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

## 2026-11-18

### Added

- **Clients are invited automatically when their first invoice goes out.** When a client turns
  Active in Notion and is not in the portal yet, the portal adds them (the Notion contact is
  their main contact), creates their SharePoint folder, requests the starter documents for
  their client type (last tax year; business documents under the business name) and emails one
  invite that says how many documents are waiting. Aleida no longer has to import and invite
  them by hand. Anything it cannot do safely (no email, an email already in use, a folder name
  already taken) comes back to Aleida as a Notion task. It can be turned off in the sync
  dashboard. ([#8](https://github.com/DubLow-Digital/quail-hollow-portal/pull/8))

## 2026-11-17

### Added

- **"Needs front and back" on document types.** Each document type has a new checkbox. When it is on, clients see "(front and back)" after the name, the request asks for both sides, and Scan document asks for the front, then the back. When it is off, front and back are never mentioned. The Driver's License keeps asking for both sides (its name is now just "Driver's License"); untick the box to stop. ([#6](https://github.com/DubLow-Digital/quail-hollow-portal/pull/6))
- **Clients can view the files they sent.** Each file under "You have sent" on a request has a View button that opens that one file straight from SharePoint, using a short-lived link SharePoint makes for that file. The portal checks the file belongs to the signed-in client first. No folder is shared, clients still never see SharePoint, and every view is recorded in the audit log. ([#5](https://github.com/DubLow-Digital/quail-hollow-portal/pull/5))
- **Document outline and auto-crop.** In Take photo and Scan document a green outline follows the page edges on the live camera view; when the picture is taken, the page is cropped and straightened automatically. In Take photo the client can switch to the whole, uncropped photo. Works offline on the phone; nothing is sent anywhere until the client taps Send. ([#3](https://github.com/DubLow-Digital/quail-hollow-portal/pull/3))
- **Approved users.** A client can now have several people who sign in for them, such as an
  office manager or a spouse. Each person signs in with their own email and sees every
  request for that client. Aleida manages them on the client page ("People who can sign in":
  add, invite, remove, reset sign-in, make main contact); the client's main contact manages
  them on a new People page. Every current client becomes their own main contact.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- **New ways for clients to sign in:** Continue with Google, Continue with Microsoft, a
  passkey (Face ID, fingerprint or a phone), or email and password followed by a code from an
  authenticator app. Signed-in clients can add a passkey or change their password under
  "Sign-in options". ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- Uploads record which approved user sent them; Aleida's client page shows "sent by".
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))

### Changed

- **Quail Hollow's real logo everywhere.** The portal header, sign-in pages, browser tab and home-screen icons, and emails now use the logo files supplied by Quail Hollow instead of the drawn stand-in. ([#3](https://github.com/DubLow-Digital/quail-hollow-portal/pull/3))
- **Take photo now uses the camera inside the portal.** It opens a live camera view in the browser instead of handing off to the phone's camera app (which is still offered if live camera access is blocked). After the picture is taken the client checks it and can retake it. ([#3](https://github.com/DubLow-Digital/quail-hollow-portal/pull/3))
- **Sign-in page redesign.** On a computer the sign-in form sits on the left half and the photo of a horse grazing under the oaks fills the right half; on a phone the photo shows as a banner above the form. ([#3](https://github.com/DubLow-Digital/quail-hollow-portal/pull/3))
- The emailed code is now only for first-time setup and recovery ("First time here? Forgot
  your password?"). It leads to a setup screen where the person creates a passkey, or a
  password plus an authenticator app. ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- Invites go to each approved user with simple sign-in steps; "documents requested" and "redo
  needed" emails go to everyone approved for the client.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- The audit log records client actions by person, and shows approved-user changes.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))

### Fixed

- **Uploads to SharePoint failed for every file.** Starting an upload sent SharePoint a file-size hint that only personal OneDrive accepts, so SharePoint refused it ("That did not work" in the portal). The hint is removed and uploads go through again. Upload failures now also record which step failed. ([#4](https://github.com/DubLow-Digital/quail-hollow-portal/pull/4))
- When an upload cannot start because SharePoint refuses it, the server log now says which step failed (finding the client's folder or opening the upload) and SharePoint's error code, so the cause can be found and fixed. No names, file paths or links are logged. ([#3](https://github.com/DubLow-Digital/quail-hollow-portal/pull/3))
- **Sign out did nothing** for clients and admins. Because the portal sends
  `Referrer-Policy: no-referrer`, browsers label the Sign out form's origin as `null`, which
  the portal's cross-site check refused. It now accepts that only when the browser itself
  marks the request same-origin (`Sec-Fetch-Site`).
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- Signing out (and expired sessions) now really remove the portal's session cookies: deleting
  a `__Host-` cookie needs the Secure attribute, which the old deletion left out, so an admin
  session could survive Sign out. ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))

### Security

- The content security policy now allows compiling WebAssembly (`'wasm-unsafe-eval'`) for the scanner's edge detector, which ships inside the portal's own code. JavaScript `eval` stays blocked and no outside scripts are loaded. ([#3](https://github.com/DubLow-Digital/quail-hollow-portal/pull/3))
- A session started with only an emailed code or only a password cannot read any client data:
  the database honors only sessions the portal approved after a full sign-in.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- Google and Microsoft sign-in accept only a verified email belonging to an approved user;
  Microsoft work accounts need a domain-verified email.
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))
- Recovery for someone who already set up a passkey or authenticator requires it first; a lost
  device goes through Aleida's "Reset sign-in".
  ([#2](https://github.com/DubLow-Digital/quail-hollow-portal/pull/2))

### Operations

- Database update `supabase/update-2026-11-17-front-back.sql` (the front-and-back setting) must be run in the Supabase SQL editor before this is merged. ([#6](https://github.com/DubLow-Digital/quail-hollow-portal/pull/6))
- Database update `supabase/update-2026-11-17.sql` must be run before this is merged. Supabase
  passkeys and the Google and Microsoft sign-in apps are set up per
  `docs/client-sign-in-setup.md`. New optional Vercel settings: `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `MS_CLIENT_SIGNIN_CLIENT_ID`, `MS_CLIENT_SIGNIN_CLIENT_SECRET`.
- Next.js advisory GHSA-mfr8-8qww-v76h (moderate) does not affect the portal (it does not use
  `use cache`); upgrade to 16.4.6 on or after Nov 23.

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
- Email turned on: a send-only Resend key for `notify.quailhollowaccounting.com` is stored as
  `RESEND_API_KEY`, and `EMAIL_FROM` is set, then production was redeployed. Invites and
  request emails had been failing because these were missing.
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
