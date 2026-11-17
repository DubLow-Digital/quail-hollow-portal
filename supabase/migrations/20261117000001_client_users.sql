-- Approved users per client, and fully signed-in sessions.
--
-- 1. client_users: everyone allowed to sign in for a client (the owner, an office manager,
--    a spouse). Each user signs in on their own (Google, Microsoft, a passkey, or password
--    plus an authenticator app) and sees everything for that client. One `primary` per
--    client: the main contact, who can add and remove the others. An email belongs to at
--    most one client.
-- 2. private.full_sessions: the Supabase sessions the portal has approved after a full
--    sign-in. A session started with only an emailed code (first-time setup or recovery) or
--    with only a password is NOT approved, so its token reads nothing, even straight from
--    the database API.
-- 3. uploads.uploaded_by: which approved user sent each file.
--
-- clients.auth_user_id is no longer used for access (kept for history; new clients leave
-- it empty).

create table public.client_users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  first_name text not null default '' check (length(first_name) <= 100),
  last_name text not null default '' check (length(last_name) <= 100),
  role text not null default 'member' check (role in ('primary', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  auth_user_id uuid references auth.users (id) on delete set null,
  password_set_at timestamptz,
  invited_at timestamptz,
  last_login_at timestamptz,
  last_login_method text check (
    last_login_method in ('google', 'microsoft', 'passkey', 'password')
  ),
  added_by_admin uuid references public.admins (id) on delete set null,
  added_by_user uuid references public.client_users (id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index client_users_email_current on public.client_users (email)
  where status <> 'removed';
create unique index client_users_auth_user_current on public.client_users (auth_user_id)
  where status <> 'removed' and auth_user_id is not null;
create unique index client_users_one_primary on public.client_users (client_id)
  where role = 'primary' and status <> 'removed';
create index client_users_client on public.client_users (client_id);

create trigger client_users_set_updated_at
  before update on public.client_users
  for each row execute function private.set_updated_at();

-- Existing clients: their own sign-in becomes the primary approved user.
insert into public.client_users (
  client_id, email, first_name, last_name, role, status, auth_user_id, invited_at, last_login_at
)
select c.id, lower(btrim(c.email)), c.first_name, c.last_name, 'primary',
       case when c.status = 'invited' then 'invited' else 'active' end,
       c.auth_user_id, c.invited_at, c.last_login_at
from public.clients c
where not exists (select 1 from public.client_users u where u.client_id = c.id);

alter table public.uploads
  add column uploaded_by uuid references public.client_users (id) on delete set null;

-- Sessions the portal approved after a full sign-in. Lives in the unexposed `private`
-- schema; only the functions below touch it.
create table private.full_sessions (
  session_id uuid primary key,
  auth_user_id uuid not null,
  method text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index full_sessions_expiry on private.full_sessions (expires_at);
alter table private.full_sessions enable row level security;

-- Called by the portal server (service role) right after a full sign-in.
create or replace function public.portal_approve_session(
  p_session_id uuid,
  p_auth_user_id uuid,
  p_method text,
  p_ttl_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ttl_seconds < 60 or p_ttl_seconds > 86400 then
    raise exception 'invalid session lifetime';
  end if;
  insert into private.full_sessions (session_id, auth_user_id, method, expires_at)
  values (p_session_id, p_auth_user_id, p_method, now() + make_interval(secs => p_ttl_seconds))
  on conflict (session_id) do update
    set auth_user_id = excluded.auth_user_id,
        method = excluded.method,
        expires_at = excluded.expires_at;
  delete from private.full_sessions where expires_at < now() - interval '1 day';
end;
$$;

create or replace function public.portal_revoke_session(p_session_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.full_sessions where session_id = p_session_id;
$$;

revoke all on function public.portal_approve_session(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.portal_revoke_session(uuid) from public, anon, authenticated;
grant execute on function public.portal_approve_session(uuid, uuid, text, integer) to service_role;
grant execute on function public.portal_revoke_session(uuid) to service_role;

-- RLS helper, redefined: the client of the signed-in approved user, and only when this
-- exact session was approved after a full sign-in.
create or replace function private.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.client_id
  from public.client_users u
  join public.clients c on c.id = u.client_id
  where u.auth_user_id = auth.uid()
    and u.status <> 'removed'
    and c.status <> 'archived'
    and exists (
      select 1
      from private.full_sessions s
      where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.auth_user_id = auth.uid()
        and s.expires_at > now()
    )
  limit 1;
$$;

drop policy if exists clients_select_own on public.clients;
create policy clients_select_own on public.clients
  for select to authenticated
  using (id = (select private.current_client_id()));

alter table public.client_users enable row level security;
revoke all on public.client_users from anon, authenticated;
grant all on public.client_users to service_role;

-- Approved users of a client can see who else can sign in for it (names, emails, roles).
grant select (id, client_id, email, first_name, last_name, role, status, last_login_at)
  on public.client_users to authenticated;
create policy client_users_select_same_client on public.client_users
  for select to authenticated
  using (client_id = (select private.current_client_id()) and status <> 'removed');
