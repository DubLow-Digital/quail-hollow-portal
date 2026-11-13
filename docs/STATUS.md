# Status

_Last updated: November 13, 2026_

## Shipped (code complete, on branch `claude/charming-hamilton-mexkiv`, draft PR #1)

| #   | Milestone                                                                                                                        | State                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Scaffold: Next.js 16, Tailwind 4, Supabase clients, lint/format, security headers, `.env.example`, README, CI                    | Done                               |
| 2   | Migrations, RLS on every table, column-level grants, seed data, RLS tests                                                        | Done, 33 DB tests                  |
| 3   | Graph service (token cache, children, create folder, upload session, get item), Entra runbook, grant and check scripts           | Done, mocked tests                 |
| 4   | Admin Microsoft sign-in with allowlist; client CRUD; folder browser; link or create folder                                       | Done                               |
| 5   | Document type library, bundles, assigning requests, invite and "documents requested" email                                       | Done                               |
| 6   | Client one-time-code sign-in, rate limits, 30 min idle / 12 h absolute sessions, checklist                                       | Done                               |
| 7   | Upload flow: photo, multi-page scan to PDF, choose file, server naming, direct chunked upload, verification, Aleida notification | Done, upload logic unit tested     |
| 8   | Accept / needs-redo with note and email; audit log screen                                                                        | Done                               |
| 9   | Hardening: CSP review, error pages, offline/retry, accessibility, Lighthouse, security summary                                   | Done (see below)                   |
| —   | Branding from the Quail Hollow logo (palette, serif wordmark, nest mark, emails)                                                 | Done; real logo files still to add |

### Test results (local)

- `npm test`: 103 unit tests pass
- `npm run test:db`: 33 RLS/database tests pass against Postgres 16
- `npm run test:e2e`: 28 browser smoke tests pass (iPhone and Android viewports)
- Lighthouse mobile, `/login` and `/admin/signin`: performance 99, accessibility 100,
  best practices 96–100. SEO is intentionally low (the portal tells search engines not to index it).
- Typecheck, lint and Prettier clean; production build succeeds

## Next: milestone 10, deploy to a Vercel preview (needs Todd's go-ahead)

These create cloud resources or touch Aleida's tenant, so they wait for approval:

1. Supabase project (docs/supabase-setup.md): apply migrations, Auth settings, Resend SMTP,
   code email template
2. Entra apps in Aleida's tenant and the one-site grant (docs/entra-setup.md), then
   `npm run graph:check`
3. Resend: verify the sending domain (DNS change)
4. Vercel project, env vars, preview protection (docs/deploy.md)
5. Todd tests on iPhone and Android with the fake "Todd Test" client (docs/deploy.md step 5)

## Not yet verified (needs real services)

- **Full end-to-end flow with real Supabase Auth and PostgREST.** The build sandbox could not
  run them (container images blocked; running downloaded release binaries was not approved).
  Every piece is tested separately; the preview test in milestone 10 covers the whole path.
- **Browser upload straight to SharePoint (CORS).** Graph upload-session URLs accept
  cross-origin PUTs from browsers; confirm on the first preview upload.
- Graph behavior against the real tenant (folder creation, rename on conflict, item lookup).

## Open questions for Todd

1. **Portal domain:** `secure.quailhollowaccounting.com` (proposed) while `portal.` stays on SuiteDash?
2. **SharePoint location:** which site and library hold client folders, and do existing client
   folders get linked as they are or re-created in the standard structure?
3. **Todd's admin access:** Todd's account is in DubLow's tenant. Recommended: invite him as a
   B2B guest in Aleida's tenant (no code change). Alternative documented in entra-setup.md step 6.
4. **Social Security cards:** keep as images, or replace later with a secure typed field?
5. **Retention:** how long to keep upload metadata and audit logs?
6. **Logo files:** please add `public/brand/logo-horizontal.png` (nest + wordmark, transparent
   background) to the repo; the portal switches to it automatically. The images shared in chat
   could not be saved as files from this session.
7. **Business documents filing:** Formation documents, EIN letter and W-9 file under
   `Businesses/{business}`; the business return under `Businesses/{business}/{year}`. Bank
   statements file under `Individual/Income Documents/{year}`. Aleida can change any of these
   per document type; confirm the defaults.
8. **Admin idle timeout:** set to 60 minutes (clients are 30). OK?
9. **MFA:** recommend a Conditional Access policy requiring MFA on the admin sign-in app.

## Decisions made during the build

- Admin sign-in uses MSAL directly (auth code + PKCE) instead of Auth.js, avoiding a beta
  dependency; the callback path matches the brief's redirect URI.
- Requests that file into `{business}` folders carry a business name, entered when assigning.
- A request can receive several files (for example multiple W-2s) until Aleida accepts it.
- Photos are re-encoded in the browser (~2400 px JPEG), which also strips GPS metadata.
- The sign-in code email is the Supabase "Magic Link" template showing `{{ .Token }}`.
- Rate limits live in Postgres (no extra paid service).

## Phase 1b / later

- Automatic page edge detection and perspective crop in Scan mode (`jscanify`, loaded only on
  the scan screen)
- Scheduled cleanup of uploads abandoned in the browser (currently labeled "Did not finish")
- Out of scope for Phase 1 per the brief: locked fillable forms (check roster), delivering
  finished documents to clients, Notion sync, QuickBooks, Lead Alchemist sync, e-signature, payments
