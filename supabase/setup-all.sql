-- GENERATED FILE. Do not edit; run `npm run db:bundle` after changing a migration.
-- Paste into the Supabase SQL editor of a NEW project and run once.
-- Contains every migration in supabase/migrations, in order. No test or seed data.

-- >>> 20261113000001_init.sql
-- Quail Hollow Client Portal: core schema, row level security and helper functions.
--
-- Principles (see CLAUDE.md section 4):
--   * Every table has RLS enabled. Clients read only their own client record, requests,
--     uploads and the document types those requests reference. Clients never write directly.
--   * All admin work runs server side with the service role after an admin check.
--   * No file contents are stored. Uploads hold metadata only.
--   * The audit log holds IDs and event types only and is append-only.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.client_status as enum ('invited', 'active', 'archived');
create type public.request_status as enum ('requested', 'uploaded', 'accepted', 'redo');
create type public.upload_status as enum ('pending', 'complete', 'failed');
create type public.actor_type as enum ('client', 'admin', 'system');
create type public.entity_type as enum ('individual', 'schedule_c', '1120s', '1065', 'other');
create type public.capture_method as enum ('photo', 'scan', 'file');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- admins
-- ---------------------------------------------------------------------------
create table public.admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and char_length(email) <= 254),
  display_name text not null default '' check (char_length(display_name) <= 200),
  ms_object_id text unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 100),
  email text not null unique check (email = lower(email) and char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 30),
  entity_types public.entity_type[] not null default '{individual}',
  status public.client_status not null default 'invited',
  sharepoint_drive_id text,
  sharepoint_folder_id text,
  sharepoint_folder_path text check (sharepoint_folder_path is null or char_length(sharepoint_folder_path) <= 400),
  sharepoint_folder_web_url text check (sharepoint_folder_web_url is null or char_length(sharepoint_folder_web_url) <= 2000),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  invited_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A SharePoint folder can belong to only one client.
create unique index clients_sharepoint_folder_unique
  on public.clients (sharepoint_folder_id)
  where sharepoint_folder_id is not null;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- document_types
-- ---------------------------------------------------------------------------
create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  slug_for_filename text not null check (slug_for_filename ~ '^[A-Za-z0-9-]{1,40}$'),
  naming_template text not null
    default '{FirstInitial}{LastName}_{DocSlug}[_{TaxYear}]_{YYYY-MM-DD}.{ext}'
    check (char_length(naming_template) <= 200),
  target_subfolder text not null default '' check (char_length(target_subfolder) <= 300),
  accepted_mime text[] not null default '{application/pdf,image/jpeg,image/png}'
    check (cardinality(accepted_mime) between 1 and 20),
  max_mb integer not null default 50 check (max_mb between 1 and 250),
  requires_year boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger document_types_set_updated_at
  before update on public.document_types
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- request bundles
-- ---------------------------------------------------------------------------
create table public.request_bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now()
);

create table public.request_bundle_items (
  bundle_id uuid not null references public.request_bundles (id) on delete cascade,
  document_type_id uuid not null references public.document_types (id) on delete cascade,
  sort_order integer not null default 100,
  primary key (bundle_id, document_type_id)
);

-- ---------------------------------------------------------------------------
-- document_requests
-- ---------------------------------------------------------------------------
create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  document_type_id uuid not null references public.document_types (id) on delete restrict,
  tax_year smallint check (tax_year is null or tax_year between 1990 and 2100),
  business_name text check (business_name is null or char_length(btrim(business_name)) between 1 and 120),
  note_to_client text check (note_to_client is null or char_length(note_to_client) <= 1000),
  redo_note text check (redo_note is null or char_length(redo_note) <= 1000),
  status public.request_status not null default 'requested',
  requested_by uuid references public.admins (id) on delete set null,
  requested_at timestamptz not null default now(),
  due_date date,
  status_changed_at timestamptz not null default now(),
  reviewed_by uuid references public.admins (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index document_requests_client_status_idx on public.document_requests (client_id, status);
create index document_requests_document_type_idx on public.document_requests (document_type_id);

create trigger document_requests_set_updated_at
  before update on public.document_requests
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- uploads (metadata only: file bytes go straight from the browser to SharePoint)
-- ---------------------------------------------------------------------------
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.document_requests (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  final_filename text not null check (char_length(final_filename) between 1 and 200),
  target_folder_id text not null,
  target_folder_path text not null check (char_length(target_folder_path) <= 400),
  sharepoint_item_id text,
  sharepoint_web_url text,
  declared_size_bytes bigint not null check (declared_size_bytes > 0),
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  mime text not null check (char_length(mime) <= 100),
  page_count integer check (page_count is null or page_count between 1 and 100),
  capture_method public.capture_method not null default 'file',
  status public.upload_status not null default 'pending',
  failure_reason text check (failure_reason is null or failure_reason ~ '^[a-z_]{1,60}$'),
  started_at timestamptz not null default now(),
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);

create index uploads_request_idx on public.uploads (request_id);
create index uploads_client_idx on public.uploads (client_id);
create index uploads_status_started_idx on public.uploads (status, started_at desc);

-- ---------------------------------------------------------------------------
-- audit_log (append-only, IDs and event types only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_type public.actor_type not null,
  actor_id uuid,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$' and char_length(action) <= 80),
  target_type text check (target_type is null or target_type ~ '^[a-z_]{1,40}$'),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  ip inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_type, actor_id, created_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);

create or replace function private.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each statement execute function private.audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- rate_limits (keys are keyed hashes, never raw emails or IPs)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null check (count >= 0)
);

-- Fixed-window counter. Returns true when the call is within the limit.
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_max < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit parameters';
  end if;

  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
          when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else rl.count + 1
        end,
        window_start = case
          when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else rl.window_start
        end
  returning count into v_count;

  -- Opportunistic cleanup keeps the table small without a scheduler.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS helper: the client record that belongs to the signed-in Supabase user.
-- Lives in the unexposed `private` schema. SECURITY DEFINER avoids recursive policy checks.
-- ---------------------------------------------------------------------------
create or replace function private.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.clients c
  where c.auth_user_id = auth.uid()
    and c.status <> 'archived'
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing for anon/authenticated, then grant the minimum.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

revoke all on function private.current_client_id() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_client_id() to authenticated;

-- Column-level grants: clients never see SharePoint locations, admin IDs or templates.
grant select (id, first_name, last_name, email, status) on public.clients to authenticated;

grant select (
  id, client_id, document_type_id, tax_year, business_name, note_to_client, redo_note,
  status, requested_at, due_date, status_changed_at
) on public.document_requests to authenticated;

grant select (
  id, name, description, accepted_mime, max_mb, requires_year, sort_order
) on public.document_types to authenticated;

grant select (
  id, request_id, client_id, final_filename, size_bytes, mime, page_count,
  capture_method, status, started_at, uploaded_at
) on public.uploads to authenticated;

-- Service role keeps full access (it bypasses RLS) for server-side admin operations.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant usage on schema private to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.clients enable row level security;
alter table public.document_types enable row level security;
alter table public.request_bundles enable row level security;
alter table public.request_bundle_items enable row level security;
alter table public.document_requests enable row level security;
alter table public.uploads enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;

-- admins, request_bundles, request_bundle_items, audit_log, rate_limits:
-- no policies, so anon and authenticated can never read or write them.

create policy clients_select_own on public.clients
  for select to authenticated
  using (auth_user_id = (select auth.uid()) and status <> 'archived');

create policy document_requests_select_own on public.document_requests
  for select to authenticated
  using (client_id = (select private.current_client_id()));

create policy uploads_select_own on public.uploads
  for select to authenticated
  using (client_id = (select private.current_client_id()));

create policy document_types_select_requested on public.document_types
  for select to authenticated
  using (
    exists (
      select 1
      from public.document_requests r
      where r.document_type_id = document_types.id
        and r.client_id = (select private.current_client_id())
    )
  );

-- No insert, update or delete policies exist for anon or authenticated on any table.

-- >>> 20261113000002_reference_data.sql
-- Reference data: the starting document type library and request bundles.
-- Aleida can edit all of this from /admin/document-types and /admin/bundles.
-- Target subfolders are relative to each client's folder ("{LastName}, {FirstName}").
-- Tokens: {year} = the request's tax year, {business} = the request's business name.

insert into public.document_types
  (name, description, slug_for_filename, target_subfolder, accepted_mime, max_mb, requires_year, sort_order)
values
  ('Driver''s License (front and back)',
   'A clear picture of the front and back of your current driver''s license or state ID. Use "Scan document" to capture both sides as one file.',
   'DriversLicense', 'Individual/ID',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 25, false, 10),
  ('Social Security Card',
   'A clear picture of your Social Security card.',
   'SocialSecurityCard', 'Individual/ID',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 25, false, 20),
  ('Prior-Year Federal Tax Return',
   'Your complete federal return (Form 1040 and all schedules) for the year shown.',
   'FederalReturn', 'Individual/Tax Returns/{year}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 60, true, 30),
  ('Prior-Year State Tax Return',
   'Your complete state return for the year shown, if you filed one.',
   'StateReturn', 'Individual/Tax Returns/{year}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 60, true, 40),
  ('W-2',
   'Each W-2 you received from an employer for the year shown.',
   'W2', 'Individual/Income Documents/{year}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 25, true, 50),
  ('1099 (any)',
   'Any 1099 forms you received for the year shown (1099-NEC, 1099-INT, 1099-DIV, 1099-R, 1099-K and others).',
   '1099', 'Individual/Income Documents/{year}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 25, true, 60),
  ('Bank Statement',
   'Bank statements for the period requested. Download the PDF from your bank''s website if you can.',
   'BankStatement', 'Individual/Income Documents/{year}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 60, true, 70),
  ('Business Formation Documents',
   'Articles of organization or incorporation, operating agreement or bylaws for the business shown.',
   'BusinessFormation', 'Businesses/{business}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 60, false, 80),
  ('EIN Letter',
   'The IRS letter assigning your business its Employer Identification Number (CP 575 or 147C).',
   'EINLetter', 'Businesses/{business}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 25, false, 90),
  ('W-9',
   'A completed and signed Form W-9 for the business shown.',
   'W9', 'Businesses/{business}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 25, false, 100),
  ('Prior-Year Business Return',
   'The complete business return (1120-S, 1065 or Schedule C) for the year shown.',
   'BusinessReturn', 'Businesses/{business}/{year}',
   '{application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp}', 60, true, 110)
on conflict (name) do nothing;

insert into public.request_bundles (name, description)
values
  ('New individual tax client', 'ID, Social Security card, prior-year returns and income forms.'),
  ('New business client', 'Formation documents, EIN letter, W-9, prior-year business return and statements.')
on conflict (name) do nothing;

insert into public.request_bundle_items (bundle_id, document_type_id, sort_order)
select b.id, t.id, t.sort_order
from public.request_bundles b
join public.document_types t on t.name in (
  'Driver''s License (front and back)',
  'Social Security Card',
  'Prior-Year Federal Tax Return',
  'Prior-Year State Tax Return',
  'W-2',
  '1099 (any)'
)
where b.name = 'New individual tax client'
on conflict do nothing;

insert into public.request_bundle_items (bundle_id, document_type_id, sort_order)
select b.id, t.id, t.sort_order
from public.request_bundles b
join public.document_types t on t.name in (
  'Driver''s License (front and back)',
  'Business Formation Documents',
  'EIN Letter',
  'W-9',
  'Prior-Year Business Return',
  'Bank Statement'
)
where b.name = 'New business client'
on conflict do nothing;

-- >>> 20261114000001_external_links.sql
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
