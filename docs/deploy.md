# Deploy runbook (Vercel)

Ask Todd before creating any of these resources. Order: Supabase → Entra apps → Resend → Vercel.

## 1. Prerequisites

- Supabase project set up per [`supabase-setup.md`](./supabase-setup.md)
- Entra apps and SharePoint grant per [`entra-setup.md`](./entra-setup.md), and
  `npm run graph:check` passing
- Resend domain verified (see supabase-setup.md step 4)

## 2. Create the Vercel project (DubLow team)

1. **Add New → Project → Import** `DubLow-Digital/quail-hollow-portal`.
2. Framework preset: Next.js (defaults for build and output). Node.js 22.
3. Region: `iad1` (Washington, D.C.), set in `vercel.json`, next to Supabase US East.
4. **Settings → Deployment Protection**: keep Vercel Authentication on for Preview deployments
   so previews are not public.

## 3. Environment variables

Add every name from [`.env.example`](../.env.example) for **Production** and **Preview**. Mark
all of them Sensitive except `NEXT_PUBLIC_*`, `APP_BASE_URL`, `SP_HOSTNAME` and
`ADMIN_ALLOWLIST`.

| Variable        | Production                                                    | Preview                                   |
| --------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `APP_BASE_URL`  | `https://secure.quailhollowaccounting.com` (pending decision) | the preview URL you test on               |
| `AUTH_SECRET`   | `openssl rand -base64 48`                                     | a different random value                  |
| everything else | from the runbooks                                             | same, or a separate test Supabase project |

For previews, add the preview callback URL
(`https://<preview-host>/api/auth/callback/microsoft-entra-id`) to the admin sign-in app's
redirect URIs.

## 4. Domain

The brief proposes `secure.quailhollowaccounting.com` while `portal.` still points to SuiteDash.
Once decided: **Settings → Domains → Add**, then create the CNAME the dashboard shows at the
DNS host. Update `APP_BASE_URL`, the Supabase Site URL, and the Entra redirect URI to match.

## 5. Smoke test after each deploy

1. `/login` loads; response headers include `content-security-policy` with a nonce,
   `strict-transport-security`, `x-frame-options: DENY`.
2. Admin: sign in with Microsoft → `/admin`.
3. Create a test client named "Todd Test" with an inbox you control, create their folder,
   request "Driver's License" and "Prior-Year Federal Tax Return" (2025).
4. On a phone: sign in with the emailed code; take a photo of a fake license; scan three pages
   of a fake return; upload a 40 MB test PDF.
5. Confirm in SharePoint: `Test, Todd/Individual/ID/TTest_DriversLicense_<date>.jpg` and a
   three-page PDF in `Individual/Tax Returns/2025`; Aleida's notification emails arrived.
6. Check `/admin/audit` shows the sign-ins, uploads and admin actions; check Vercel logs show no
   emails, codes or upload URLs.

## 6. Rollback

Vercel → Deployments → previous good deployment → **Promote to Production**. Database
migrations are additive; if one must be reverted, write a new migration rather than editing an
applied one.
