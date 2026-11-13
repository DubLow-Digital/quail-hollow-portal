# Notion and Lead Alchemist sync

The portal keeps clients in step with the firm's Notion CRM and Lead Alchemist through the
existing **quail-hollow-sync** service (`sync.quailhollowaccounting.com`). The portal holds no
Notion or Lead Alchemist credentials: it holds one shared secret and talks only to the sync
service.

```
 Portal  ──(signed)──▶  quail-hollow-sync  ──▶  Notion Clients + Lead Alchemist contacts
 Portal  ◀──(signed)──  quail-hollow-sync  ◀──  Lead Alchemist webhooks, Notion edits (10-min cron)
```

## What happens

| When                                                            | Result                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Aleida adds a client in the portal                              | The sync service finds or creates the Lead Alchemist contact (tag `client portal`) and the Notion client, and the portal stores both links. |
| Aleida edits or archives a portal client                        | Name, email, phone and portal status are updated in both.                                                                                   |
| Aleida imports from Lead Alchemist or Notion (Clients → Import) | The portal client is created with both links. No invite is sent until she sends it.                                                         |
| A linked contact changes in Lead Alchemist                      | The portal client's name and phone update.                                                                                                  |
| A linked client is edited in Notion                             | The portal client's phone updates (and name, when "Primary Contact" is exactly "First Last"). Picked up within 10 minutes.                  |
| "Sync now" on a client profile                                  | Pushes that client again and shows the result.                                                                                              |

Matching, strongest first: the stored link, the portal client ID, email, then the other system's ID.

## Rules that keep this safe

- **Only contact fields move:** first and last name, email, phone, client type (from entity
  types) and portal status. Documents, SSNs, notes, requests and uploads never leave the portal.
- **The sign-in email never changes from outside.** A change in Notion or Lead Alchemist
  cannot redirect a client's sign-in codes; only Aleida can change it in the portal.
- **Outside changes never create portal clients.** New leads stay in Lead Alchemist and Notion
  until Aleida imports or adds them.
- **No loops:** updates arriving from the sync service are never sent back to it.
- **Links are never silently re-pointed.** If an update would link a portal client to a
  different Notion page or contact than the one stored, it is refused and recorded in the
  audit log (`sync.rejected`, `link_conflict`).
- **Every call is signed** (HMAC-SHA256 over timestamp, method, path and body; 5-minute
  window) and the endpoint is rate limited. It returns 404 until the secret is configured.
- Every push, update received and rejection is in the audit log under "Notion and Lead
  Alchemist sync".

## Setup

1. Generate one secret: `openssl rand -hex 32`.
2. Portal (Vercel project `quail-hollow-portal`): `SYNC_HUB_URL=https://sync.quailhollowaccounting.com`
   and `SYNC_HUB_SECRET=<secret>`.
3. Sync service (Vercel project `quail-hollow-sync`, or its dashboard settings):
   `PORTAL_BASE_URL=<portal address>` and `PORTAL_SYNC_SECRET=<same secret>`.
4. Database: run `supabase/migrations/20261114000001_external_links.sql` in the Supabase SQL
   editor (already included in `supabase/setup-all.sql` for new projects).
5. Lead Alchemist: give the Private Integration token **Edit Contacts** (it is view-only today),
   and make sure no "Contact Created" workflow sends marketing to contacts tagged `client portal`.
6. Optional, Notion Clients data source: add a text property **Portal Client ID** and a select
   **Client Portal** (Invited, Active, Archived). Without them the sync still works and
   matches by email.
7. Optional, Lead Alchemist: a "Contact Changed" workflow with a webhook to
   `https://sync.quailhollowaccounting.com/api/ghl/webhook?event=update` (header `X-QH-Secret`),
   so contact edits reach Notion and the portal right away.
8. Deploy both, then use "Sync now" on the fake "Todd Test" client and check the sync service
   dashboard's Activity tab.

## Endpoints

| Direction     | Endpoint                      | Purpose                                                                    |
| ------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Portal → sync | `POST /api/portal/client`     | Upsert one client; returns `notion_page_id`, `ghl_contact_id`              |
| Portal → sync | `POST /api/portal/candidates` | Search (`query`) or fetch (`id`) Notion clients or Lead Alchemist contacts |
| Sync → portal | `POST /api/sync/clients`      | A linked record changed; updates an existing portal client only            |

Headers on every call: `X-QH-Timestamp` (unix seconds) and
`X-QH-Signature: v1=<hex HMAC-SHA256(secret, "v1:{timestamp}:{METHOD}:{path}:{body}")>`.
Code: `src/lib/sync/protocol.ts` here and `lib/portal.js` in quail-hollow-sync.
