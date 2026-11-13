-- Portal settings chosen by an admin in the portal (for now: the SharePoint location of the
-- client folders, picked on the Connect SharePoint page). Server-side only: RLS on, no
-- policies, no grants to anon or authenticated. Values are IDs and names, never secrets.

create table public.portal_settings (
  key text primary key check (key ~ '^[a-z][a-z_]{0,59}$'),
  value text not null check (char_length(value) <= 2000),
  updated_by uuid references public.admins (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.portal_settings enable row level security;
revoke all on public.portal_settings from anon, authenticated;
grant all on public.portal_settings to service_role;
