# Quail Hollow Client Portal

A mobile-first portal where Quail Hollow Accounting clients sign in with a one-time code,
see the documents Aleida has requested, and upload each one by taking a photo, scanning
pages into a PDF, or choosing a file. Files go straight from the browser into the client's
SharePoint folder; this app only stores metadata.

The full Phase 1 brief lives in [`CLAUDE.md`](./CLAUDE.md). Current progress and open
questions are in [`docs/STATUS.md`](./docs/STATUS.md).

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind CSS 4
- Supabase: Postgres, Auth (email one-time codes for clients), row level security
- Microsoft Graph via `@azure/msal-node` (client credentials, `Sites.Selected`) for SharePoint
- Microsoft Entra sign-in (MSAL auth code + PKCE) for admins, limited to an allowlist
- Resend for transactional email
- `pdf-lib` in the browser to combine scanned pages into one PDF
- Zod for input validation, Vitest and Playwright for tests

## Local development

```bash
npm ci
cp .env.example .env.local   # fill in values; never commit them
npm run dev
```

Database migrations live in `supabase/migrations`. Apply them to a Supabase project with
the Supabase CLI (`supabase db push`) or run them in order in the SQL editor. See
[`docs/supabase-setup.md`](./docs/supabase-setup.md) for Auth settings (code length, expiry,
custom SMTP, email template).

## Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm test                      # unit tests
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
npm run build && npm run test:e2e   # Playwright smoke tests on phone viewports
```

`test:db` creates a throwaway database, applies a small Supabase compatibility shim
(`tests/db/supabase-shim.sql`) plus every migration, and proves row level security:
a client can read only their own records and can write nothing directly.

## Security model in one paragraph

File bytes never touch our servers or database: the server validates the request, builds
the filename and folder, and asks Graph for a one-time upload session URL, which the
browser uses to upload in chunks directly to SharePoint. The Entra app holds
`Sites.Selected` write access to a single site. Every table has RLS; admin operations run
server-side with the service role after an admin session check. Logs and the audit table
hold IDs and event types only. See [`docs/security-summary.md`](./docs/security-summary.md).

## Branding

Colors and type come from the Quail Hollow logo (warm brown wordmark, gold rule, sage and cream
eggs). The Trajan-style wordmark uses Cinzel, self-hosted under the SIL Open Font License
(`src/app/fonts`). To use the real logo files, add `public/brand/logo-horizontal.png`; see
[`public/brand/README.md`](./public/brand/README.md).

## Setup runbooks

- [`docs/entra-setup.md`](./docs/entra-setup.md): Entra apps, SharePoint site grant, verification scripts
- [`docs/supabase-setup.md`](./docs/supabase-setup.md): Supabase project, Auth and SMTP settings
- [`docs/deploy.md`](./docs/deploy.md): Vercel project and environment variables
