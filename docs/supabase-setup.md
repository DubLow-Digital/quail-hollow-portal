# Supabase setup runbook

Ask Todd before creating the project (new cloud resource). Recommended: a dedicated project
named `quail-hollow-portal` in the DubLow organization, region **East US**, on a plan that
includes daily backups.

## 1. Create the project and apply migrations

**Recommended: through Vercel (env vars are added for you).**

1. Vercel → project `quail-hollow-portal` → **Storage → Create Database → Supabase**.
2. Plan: Free (or Pro for daily backups at go-live). Region: **East US (N. Virginia)**, next to the
   `iad1` functions. Connect it to the project for **Production and Preview**.
3. Vercel adds `NEXT_PUBLIC_SUPABASE_URL`, the anon/publishable key and the service-role/secret key.
   The portal accepts either key naming.
4. Open the new project in Supabase → **SQL Editor** → paste all of
   [`supabase/setup-all.sql`](../supabase/setup-all.sql) → **Run** once. It contains every
   migration in order (schema, RLS, reference data) and no test data.

**Alternative: create it at supabase.com** (DubLow organization, East US), then:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push          # applies supabase/migrations in order
```

and copy from **Project Settings → API** into Vercel:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` (or publishable) key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` (or secret) key → `SUPABASE_SERVICE_ROLE_KEY` (server only, never exposed)

Do **not** run `supabase/seed.sql` against a real project; it holds fake people for local
development only.

## 2. Lock down the Data API

- **API → Exposed schemas**: `public` only. (`private` holds the RLS helper and must stay hidden.)
- Every table already has RLS; anon has no privileges and signed-in clients have column-level
  read access to their own rows only. Run `npm run test:db` to prove it after any schema change.

## 3. Auth settings (Authentication → Providers / Settings)

| Setting                    | Value                     | Why                                                                  |
| -------------------------- | ------------------------- | -------------------------------------------------------------------- |
| Allow new users to sign up | **Off**                   | Only Aleida creates client accounts                                  |
| Email provider             | On; Confirm email off     | Codes are the only sign-in method                                    |
| Email OTP expiration       | **600 seconds**           | Brief: codes expire in 10 minutes                                    |
| Email OTP length           | 6                         | Matches the code entry screen (accepts 6–10)                         |
| Access token (JWT) expiry  | 900 seconds               | Short-lived tokens; the portal adds its own idle and absolute limits |
| Refresh token rotation     | On, reuse interval 10 s   | Default                                                              |
| Anonymous sign-ins         | Off                       |                                                                      |
| Rate limits → emails sent  | ~30/hour                  | Supabase's own limit; the portal also limits per email and per IP    |
| Site URL                   | `https://<portal-domain>` |                                                                      |
| Redirect URLs              | none needed               | Codes, not links                                                     |

## 4. Custom SMTP through Resend (login codes come from Quail Hollow)

1. In Resend, verify the sending domain (for example `mail.quailhollowaccounting.com`) with the
   DNS records Resend gives you (SPF, DKIM, and a DMARC policy). Ask Todd before changing DNS.
2. In Supabase **Authentication → Emails → SMTP Settings**, enable custom SMTP:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key with
     **sending access only**
   - Sender email: `portal@<verified domain>`; sender name: `Quail Hollow Accounting`
3. Use the same verified domain for `EMAIL_FROM`, for example
   `Quail Hollow Accounting <portal@mail.quailhollowaccounting.com>`.

## 5. Email template for the code

**Authentication → Emails → Templates → Magic Link**. Supabase sends this template for
`signInWithOtp`, so it must show the code (`{{ .Token }}`), not a link. Paste the contents of
[`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html) and set the subject
to `Your Quail Hollow sign-in code`.

## 6. Verify

1. Create a fake test client in `/admin/clients/new` (for example "Todd Test",
   an email inbox you control).
2. On a phone, open the portal, enter that email, and confirm the code email arrives from the
   Quail Hollow sender and shows a 6-digit code.
3. Enter a wrong code 11 times: the 11th attempt in 15 minutes is refused with
   "Too many attempts".
4. Leave the phone idle for 30 minutes: the next tap returns to the sign-in page.
