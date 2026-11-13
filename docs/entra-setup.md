# Entra and SharePoint setup runbook

Todd performs these steps by hand in **Aleida's Microsoft 365 tenant**. Nothing here is
automated against her tenant without Todd running it. Record every ID in Vercel environment
variables (Production and Preview) and in your local `.env.local`, never in the repo.

Time needed: about 30 minutes. You need Global Admin (or Application Administrator plus a
SharePoint Administrator for step 5) in Aleida's tenant.

---

## 1. Create the portal app registration

1. Entra admin center → **Identity → Applications → App registrations → New registration**.
2. Name: `Quail Hollow Client Portal`.
3. Supported account types: **Accounts in this organizational directory only (single tenant)**.
4. Redirect URI: leave empty (this app never signs anyone in).
5. Register. From **Overview** copy:
   - Directory (tenant) ID → `MS_TENANT_ID`
   - Application (client) ID → `MS_PORTAL_CLIENT_ID`

## 2. Add the `Sites.Selected` permission

1. **API permissions → Add a permission → Microsoft Graph → Application permissions**.
2. Search `Sites.Selected`, tick it, **Add permissions**.
3. Remove the default delegated `User.Read` from this app (it is not needed).
4. Click **Grant admin consent for <tenant>** and confirm the status shows a green check.

> Never add `Sites.ReadWrite.All`, `Sites.FullControl.All` or `Files.ReadWrite.All` to this
> app. `Sites.Selected` alone grants access to nothing until step 5 grants one site.

## 3. Create a credential

**Preferred for production: a certificate.** For the first preview a client secret is fine.

- Secret: **Certificates & secrets → Client secrets → New client secret**, description
  `vercel-portal`, expiry 12 months. Copy the **Value** immediately → `MS_PORTAL_CLIENT_SECRET`.
- Put a calendar reminder two weeks before expiry to rotate it (create the new secret, update
  Vercel, redeploy, then delete the old one).

## 4. Find the site, library and client root folder

You need three IDs. The grant script in step 5 prints the first two for you.

- `SP_SITE_ID`: the site that holds client folders, e.g. `quailhollowaccounting.sharepoint.com:/sites/Clients`.
  Graph form: `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}`.
- `SP_DRIVE_ID`: the document library inside that site. `GET /sites/{site-id}/drives`
  (usually the library called "Documents").
- `SP_CLIENT_ROOT_FOLDER_ID`: the folder whose children are the per-client folders. In
  Graph Explorer, `GET /drives/{drive-id}/root/children`, then drill into the folder and copy
  its `id`. If clients live at the library root, use the root's id
  (`GET /drives/{drive-id}/root`).
- `SP_HOSTNAME` (optional but recommended): e.g. `quailhollowaccounting.sharepoint.com`.
  It narrows the browser's Content-Security-Policy to that one host.

## 5. Grant the portal app write access to that one site

The grant must come from an identity holding `Sites.FullControl.All`. Use the script:

```bash
# In .env.local: MS_TENANT_ID and MS_PORTAL_CLIENT_ID
npm run graph:grant -- --site quailhollowaccounting.sharepoint.com:/sites/Clients --dry-run
npm run graph:grant -- --site quailhollowaccounting.sharepoint.com:/sites/Clients
```

By default the script signs you in with a device code as a Global Admin (it uses Microsoft's
"Graph Command Line Tools" public client and asks for `Sites.FullControl.All` delegated).
Alternatively, create a temporary app with **application** `Sites.FullControl.All`, put its
credentials in `GRANT_ADMIN_CLIENT_ID` and `GRANT_ADMIN_CLIENT_SECRET`, and pass `--app`.

What the script sends (equivalent Graph Explorer call):

```http
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
Content-Type: application/json

{
  "roles": ["write"],
  "grantedToIdentities": [
    { "application": { "id": "<MS_PORTAL_CLIENT_ID>", "displayName": "Quail Hollow Client Portal" } }
  ]
}
```

**Then remove the temporary access:**

- Device-code route: Entra → **Enterprise applications → Microsoft Graph Command Line Tools →
  Permissions**, review and revoke the `Sites.FullControl.All` consent (or delete the
  enterprise app if nobody else uses it).
- Temporary app route: delete the temporary app registration.

## 6. Admin sign-in app (for Aleida and Todd)

1. New registration: `Quail Hollow Portal Admin Sign-in`, single tenant.
2. Redirect URI (platform **Web**):
   `https://<portal-domain>/api/auth/callback/microsoft-entra-id`
   Add a second one for local development: `http://localhost:3000/api/auth/callback/microsoft-entra-id`.
3. **API permissions**: Microsoft Graph **delegated** `openid`, `profile`, `email`, `User.Read`.
   Grant admin consent.
4. **Certificates & secrets**: new client secret → `MS_ADMIN_CLIENT_SECRET`. Client ID →
   `MS_ADMIN_CLIENT_ID`.
5. Recommended: **Enterprise applications → Quail Hollow Portal Admin Sign-in → Properties →
   Assignment required = Yes**, then assign only Aleida (and Todd) under **Users and groups**.
   The app also enforces `ADMIN_ALLOWLIST`, so this is a second lock.
6. Recommended: a Conditional Access policy requiring MFA for this app.

**Todd's account is in a different tenant (dublowdigital.com).** Pick one:

- **Recommended:** invite `todd@dublowdigital.com` as a B2B guest in Aleida's tenant and assign
  him to the app. Nothing else changes.
- Or set `MS_ADMIN_AUTHORITY_TENANT=organizations` and
  `MS_ADMIN_ALLOWED_TENANTS=<DubLow tenant ID>`, and change the app to
  "Accounts in any organizational directory". The portal then accepts sign-ins only from
  Aleida's tenant plus the listed tenants, and only for emails in `ADMIN_ALLOWLIST`.

## 7. Verify

```bash
npm run graph:check
npm run graph:check -- --other-site quailhollowaccounting.sharepoint.com:/sites/SomeOtherSite
```

Expected: every line says PASS, including:

- token carries `Sites.Selected` and nothing broader
- the granted site is readable, the tenant root and site search are refused
- the client root folder lists, and `_portal-access-test` is created and deleted

If `_portal-access-test` creation fails with 403, the grant in step 5 is missing or read-only.

## Environment variables recap

| Variable                                                               | From step |
| ---------------------------------------------------------------------- | --------- |
| `MS_TENANT_ID`                                                         | 1         |
| `MS_PORTAL_CLIENT_ID`, `MS_PORTAL_CLIENT_SECRET`                       | 1, 3      |
| `SP_SITE_ID`, `SP_DRIVE_ID`, `SP_CLIENT_ROOT_FOLDER_ID`, `SP_HOSTNAME` | 4         |
| `MS_ADMIN_CLIENT_ID`, `MS_ADMIN_CLIENT_SECRET`                         | 6         |
| `MS_ADMIN_AUTHORITY_TENANT`, `MS_ADMIN_ALLOWED_TENANTS` (optional)     | 6         |

## Optional: narrower than one site

Microsoft Graph also offers `Lists.SelectedOperations.Selected` and
`Files.SelectedOperations.Selected`, which can scope an app to one document library or folder
instead of a whole site. Phase 1 uses `Sites.Selected` as the brief specifies; if the client
folders live on a site that also holds unrelated content, consider moving to the library-level
grant later.
