# Client sign-in setup (Google, Microsoft, passkeys, authenticator apps)

Clients, and the people they approve, sign in with one of:

- **Continue with Google** or **Continue with Microsoft**: their own account. Only a verified
  email that belongs to an approved user is accepted.
- **Sign in with a passkey**: Face ID, a fingerprint, Windows Hello or their phone.
- **Email and password, then a code from an authenticator app.**

An emailed one-time code is only used for first-time setup ("First time here?") and recovery.
Each step below is done once by Todd. Nothing here changes until it is done: the Google and
Microsoft buttons only appear once their settings exist in Vercel.

## 0. Database update (before merging)

Run `supabase/update-2026-11-17.sql` once in the Supabase SQL editor **before** the pull request
is merged. It adds approved users (every current client becomes their own main contact) and
the full sign-in check. Safe to run twice.

After the merge, clients who were signed in with an emailed code are sent to the setup screen
the next time they open the portal, to add a passkey or a password and authenticator app.

## 1. Supabase: passkeys and authenticator apps

In the Supabase dashboard for the portal project:

1. **Authentication → Multi-Factor**: authenticator apps (TOTP) **enabled** (the default).
2. **Authentication → Passkeys** (or Sign In / Providers → Passkeys): **enable passkeys**.
3. Passkey (WebAuthn) relying party:
   - **Relying party ID**: the portal's host name only, for example
     `quail-hollow-portal.vercel.app` today, or `secure.quailhollowaccounting.com` once the domain
     is decided. Passkeys are tied to this name, so set it to the final domain before clients
     create passkeys if possible.
   - **Allowed origins**: `https://` plus the same host, for example
     `https://quail-hollow-portal.vercel.app`.
   - **Display name**: `Quail Hollow Accounting`.
4. **Authentication → Providers → Email**: leave email sign-in on (it carries the setup and
   recovery codes). Public sign-up stays off.

## 2. Google sign-in

In Google Cloud Console (a DubLow or Quail Hollow project):

1. **APIs & Services → OAuth consent screen**: user type **External**, app name
   `Quail Hollow Accounting`, support email, the portal domain as an authorized domain.
   Scopes: `openid`, `email`, `profile` only (no verification needed for these). Publish the
   app (status "In production").
2. **Credentials → Create credentials → OAuth client ID**: type **Web application**.
   - Authorized redirect URI: `https://<portal-domain>/api/auth/client/sso/google/callback`
3. In Vercel (portal project, Production and Preview): `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET` (sensitive).

## 3. Microsoft sign-in

In the Entra admin center (Aleida's tenant, so clients see "Quail Hollow" on the consent
screen):

1. **App registrations → New registration**: `Quail Hollow Client Sign-in`.
   - Supported account types: **Accounts in any organizational directory and personal
     Microsoft accounts**.
   - Redirect URI (Web): `https://<portal-domain>/api/auth/client/sso/microsoft/callback`
2. **API permissions**: Microsoft Graph delegated `openid`, `profile`, `email` only. No admin
   consent needed.
3. **Token configuration → Add optional claim → ID → `email` and `xms_edov`**. The portal
   accepts a work or school account only when Microsoft confirms the email's domain belongs to
   that organization (`xms_edov`); personal Microsoft accounts are accepted as is.
4. Recommended: block unverified emails for the app in Graph Explorer (as an app admin):
   `PATCH https://graph.microsoft.com/v1.0/applications/{object-id}` with
   `{ "authenticationBehaviors": { "removeUnverifiedEmailClaim": true } }`.
5. **Certificates & secrets → New client secret**. In Vercel: `MS_CLIENT_SIGNIN_CLIENT_ID`
   (the Application ID) and `MS_CLIENT_SIGNIN_CLIENT_SECRET` (sensitive).
6. Optional but recommended: **Branding & properties → Publisher verification** with DubLow's
   Microsoft Partner ID. Without it, some clients whose employer restricts app consent see
   "Need admin approval" and must use another sign-in option.

This is a separate app from "Quail Hollow Portal Admin Sign-in" (staff only) and "Quail
Hollow Client Portal" (SharePoint access). Do not reuse either.

## 4. Check it

1. Redeploy after adding the Vercel settings.
2. On `/login`, the Google and Microsoft buttons appear.
3. Add yourself as an approved user of a test client (client page → People who can sign in),
   then try each way: Google, Microsoft, "First time here?" → passkey, and "First time
   here?" → password + authenticator.
4. The audit log shows `client.login` with the method for each.

## How recovery works

- **Forgot password:** "First time here? Forgot your password?" → emailed code → enter the
  authenticator code → choose a new password.
- **New phone, passkey not synced, or authenticator lost:** the client calls the office. On the
  client page, Aleida chooses **Reset sign-in** for that person. It signs them out everywhere
  and removes their password, passkeys and authenticator; they set up again with an emailed
  code.
