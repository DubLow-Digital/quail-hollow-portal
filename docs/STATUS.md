# Status

_Last updated: November 17, 2026. What changed and when is in [CHANGELOG.md](../CHANGELOG.md)._

## Where things stand

Phase 1 is merged ([#1](https://github.com/DubLow-Digital/quail-hollow-portal/pull/1), Nov 13)
and live at https://quail-hollow-portal.vercel.app (production deploys from `main`).

| #   | Milestone                                                                                                                        | State                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Scaffold: Next.js 16, Tailwind 4, Supabase clients, lint/format, security headers, `.env.example`, README, CI                    | Done                               |
| 2   | Migrations, RLS on every table, column-level grants, seed data, RLS tests                                                        | Done                               |
| 3   | Graph service (token cache, children, create folder, upload session, get item), Entra runbook, grant and check scripts           | Done                               |
| 4   | Admin Microsoft sign-in with allowlist; client CRUD; folder browser; link or create folder                                       | Done                               |
| 5   | Document type library, bundles, assigning requests, invite and "documents requested" email                                       | Done                               |
| 6   | Client one-time-code sign-in, rate limits, 30 min idle / 12 h absolute sessions, checklist                                       | Done                               |
| 7   | Upload flow: photo, multi-page scan to PDF, choose file, server naming, direct chunked upload, verification, Aleida notification | Done                               |
| 8   | Accept / needs-redo with note and email; audit log screen                                                                        | Done                               |
| 9   | Hardening: CSP review, error pages, offline/retry, accessibility, Lighthouse, security summary                                   | Done                               |
| 10  | Deploy and test on phones with fake client data                                                                                  | Deployed; phone test pending       |
| —   | Branding from the Quail Hollow logo (palette, serif wordmark, nest mark, emails)                                                 | Done; real logo files still to add |

Added after the Phase 1 brief, at Todd's request (Nov 13): the Files page, Notion and Lead
Alchemist sync through quail-hollow-sync, Connect SharePoint, the backup emailed-code admin
sign-in, and the full end-to-end CI test. Details in the change log.

Added Nov 17 (in review): **approved users and new client sign-in**. Each client can have
several people who sign in (owner, office manager, spouse); Aleida and the client's main
contact manage them. Clients sign in with Google, Microsoft, a passkey, or a password plus an
authenticator app; an emailed code is now only for first-time setup and recovery, and a code
alone cannot read any client data. Setup steps: `docs/client-sign-in-setup.md`.

### Tests

- `npm test`: unit tests; `npm run test:db`: RLS and database tests on Postgres 16;
  `npm run test:e2e`: browser smoke tests on iPhone and Android viewports. All run in CI.
- CI job "Full end-to-end" runs the production build against real Supabase Auth, PostgREST and
  Postgres and a SharePoint and Google/Microsoft stand-in, on a phone viewport: password +
  authenticator setup by emailed code, Google sign-in for an office manager added by the main
  contact, unapproved and unverified emails refused, passkey setup and sign-in (virtual
  authenticator), code-only and password-only sessions read nothing, recovery, removal, a
  client sees only their own requests, license photo filed as `TTest_DriversLicense_<date>.jpg`, a 3-page
  scan arrives as one PDF, a 40 MB upload, client isolation (page, API and direct database),
  accept, file browser, audit trail, Connect SharePoint, and no upload links or codes stored.
- Lighthouse mobile, `/login` and `/admin/signin`: performance 99, accessibility 100.

## Production setup

Configured in Vercel (names only): Supabase (integration), `AUTH_SECRET`, `ADMIN_ALLOWLIST`,
`APP_BASE_URL`, `MS_TENANT_ID`, `MS_PORTAL_CLIENT_ID` / `_SECRET`, `MS_ADMIN_CLIENT_ID` /
`_SECRET`, `SP_SITE_ID`, `SP_DRIVE_ID`, `SP_CLIENT_ROOT_FOLDER_ID`, `SP_HOSTNAME`,
`SYNC_HUB_URL`, `SYNC_HUB_SECRET`, `FILES_DEMO`, `ADMIN_EMAIL_LOGIN`, `RESEND_API_KEY`,
`EMAIL_FROM` (Nov 14; sending domain `notify.quailhollowaccounting.com` is verified in Resend,
and Supabase already sends sign-in codes through Resend).

Still to do:

0. **Before merging the approved users / sign-in pull request:** run
   `supabase/update-2026-11-17.sql` once in the Supabase SQL editor. Then follow
   `docs/client-sign-in-setup.md`: turn on passkeys in Supabase (relying party = the portal
   domain), and create the Google and Microsoft sign-in apps.

1. **Admin Microsoft sign-in:** assign Todd and Aleida to the "Quail Hollow Portal Admin
   Sign-in" enterprise app in Aleida's tenant (Users and groups). Until then Microsoft refuses
   the sign-in with AADSTS50105. The emailed-code sign-in works meanwhile.
2. **Email:** done Nov 14. Send one invite to confirm delivery.
3. **SharePoint check:** confirm the Files page lists the real client folders and run
   `npm run graph:check`. If the app sees no site, a Global Admin runs the one-time grant shown
   on `/admin/sharepoint`.
4. **Phone test:** Todd tests on iPhone and Android with the fake "Todd Test" client
   (docs/deploy.md step 5), including one real upload into SharePoint.
5. **After Microsoft sign-in works:** set `ADMIN_EMAIL_LOGIN` to false and remove
   `todd@dub-low.consulting` from `ADMIN_ALLOWLIST`.
6. **Sync:** give the Lead Alchemist token Edit Contacts; add the Notion properties Portal Client
   ID (text) and Client Portal (select: Invited, Active, Archived); delete the unused
   `SUITEDASH_MODE` in the sync project's Vercel settings.

## Open questions for Todd

1. **Portal domain:** `portal.quailhollowaccounting.com` still points to SuiteDash. Use
   `secure.quailhollowaccounting.com`, or move `portal.` to this portal?
2. **Existing client folders:** link them as they are, or re-create them in the standard
   structure?
3. **Social Security cards:** keep as images, or replace later with a secure typed field?
4. **Retention:** how long to keep upload metadata and audit logs?
5. **Logo files:** add `public/brand/logo-horizontal.png` (nest + wordmark, transparent
   background); the portal switches to it automatically.
6. **Business documents filing:** Formation documents, EIN letter and W-9 file under
   `Businesses/{business}`; the business return under `Businesses/{business}/{year}`. Bank
   statements file under `Individual/Income Documents/{year}`. Aleida can change any of these
   per document type; confirm the defaults.
7. **Admin idle timeout:** 60 minutes (clients are 30). OK?
8. **MFA:** recommend a Conditional Access policy requiring MFA on the admin sign-in app.
9. **Sync defaults:** new Notion records from the portal get Lead Source "Client Portal" and
   Notion's default Client Status. OK?

10. **Passkey domain:** passkeys are tied to the portal's domain. Decide the final domain
    before clients create passkeys, or they re-create them after a domain change.
11. **One client per email:** an email can sign in for only one client. A spouse who is also a
    client in her own right needs a different email for one of them. OK for now?
12. **Next.js:** a moderate advisory (GHSA-mfr8-8qww-v76h) affects 16.4.3, but only the
    `use cache` / `unstable_cache` feature, which the portal does not use. Upgrade to 16.4.6
    on or after Nov 23 (the 14-day rule for new packages).

## Decisions made during the build

- Admin sign-in uses MSAL directly (auth code + PKCE) instead of Auth.js, avoiding a beta
  dependency; the callback path matches the brief's redirect URI.
- Requests that file into `{business}` folders carry a business name, entered when assigning.
- A request can receive several files (for example multiple W-2s) until Aleida accepts it.
- Photos are re-encoded in the browser (~2400 px JPEG), which also strips GPS metadata.
- The sign-in code email is the Supabase "Magic Link" template showing `{{ .Token }}`.
- Rate limits live in Postgres (no extra paid service).
- Nov 17, at Todd's request (changes the brief's "email one-time code, no passwords"): approved
  users per client; sign-in with Google, Microsoft, a passkey, or a password plus authenticator
  app; emailed codes only for setup and recovery. Google and Microsoft are handled by the
  portal itself (OpenID Connect, no extra service), and a session can read client data only
  after the portal approves it following a full sign-in (`private.full_sessions`).
- The SharePoint location can be chosen in the portal (`portal_settings`); Vercel `SP_*`
  settings take precedence when set.

## Phase 1b / later

- ~~Automatic page edge detection and perspective crop~~ Done Nov 17 with Scanic (MIT,
  WebAssembly, ~100 KB) instead of jscanify (OpenCV.js, ~30 MB): live green outline in Take
  photo and Scan document, auto-crop and straighten on capture, "Use whole photo" option.
  Next: a manual corner editor if clients need it.
- Scheduled cleanup of uploads abandoned in the browser (currently labeled "Did not finish")
- Out of scope for Phase 1 per the brief: locked fillable forms (check roster), delivering
  finished documents to clients, QuickBooks, e-signature, payments
