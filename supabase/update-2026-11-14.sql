-- One-time update for a Supabase project set up before Nov 14, 2026.
-- Paste into the Supabase SQL editor and run. Safe to run more than once.
-- Same changes as migrations 20261114000001_external_links and 20261114000002_portal_settings.

-- Links to Notion and Lead Alchemist (admin-only columns; clients cannot read them).
alter table public.clients
  add column if not exists notion_page_id text
    check (notion_page_id is null or notion_page_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  add column if not exists ghl_contact_id text
    check (ghl_contact_id is null or ghl_contact_id ~ '^[A-Za-z0-9]{6,64}$'),
  add column if not exists sync_state text not null default 'off'
    check (sync_state in ('off', 'pending', 'ok', 'error')),
  add column if not exists sync_error text
    check (sync_error is null or sync_error ~ '^[a-z_]{1,60}$'),
  add column if not exists synced_at timestamptz;

create unique index if not exists clients_notion_page_unique
  on public.clients (notion_page_id) where notion_page_id is not null;
create unique index if not exists clients_ghl_contact_unique
  on public.clients (ghl_contact_id) where ghl_contact_id is not null;

-- Settings chosen in the portal (the SharePoint client-folders location). Server-side only.
create table if not exists public.portal_settings (
  key text primary key check (key ~ '^[a-z][a-z_]{0,59}$'),
  value text not null check (char_length(value) <= 2000),
  updated_by uuid references public.admins (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.portal_settings enable row level security;
revoke all on public.portal_settings from anon, authenticated;
grant all on public.portal_settings to service_role;
