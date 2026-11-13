-- Links from portal clients to the firm's Notion CRM and Lead Alchemist (via quail-hollow-sync).
-- Admin-only columns: no grant is added for `authenticated`, so clients cannot read them.

alter table public.clients
  add column notion_page_id text
    check (notion_page_id is null or notion_page_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  add column ghl_contact_id text
    check (ghl_contact_id is null or ghl_contact_id ~ '^[A-Za-z0-9]{6,64}$'),
  add column sync_state text not null default 'off'
    check (sync_state in ('off', 'pending', 'ok', 'error')),
  add column sync_error text
    check (sync_error is null or sync_error ~ '^[a-z_]{1,60}$'),
  add column synced_at timestamptz;

-- One portal client per Notion record and per Lead Alchemist contact.
create unique index clients_notion_page_unique
  on public.clients (notion_page_id)
  where notion_page_id is not null;

create unique index clients_ghl_contact_unique
  on public.clients (ghl_contact_id)
  where ghl_contact_id is not null;
