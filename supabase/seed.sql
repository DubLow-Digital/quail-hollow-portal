-- Local development seed. Obviously fake people only; never real client data.
-- Reference data (document types, bundles) comes from the migrations.

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'todd.test@example.com', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pat.example@example.com', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.clients (id, first_name, last_name, email, status, auth_user_id, entity_types)
values
  ('00000000-0000-4000-8000-0000000c1e01', 'Todd', 'Test', 'todd.test@example.com', 'invited',
   '00000000-0000-4000-8000-00000000c001', '{individual}'),
  ('00000000-0000-4000-8000-0000000c1e02', 'Pat', 'Example', 'pat.example@example.com', 'invited',
   '00000000-0000-4000-8000-00000000c002', '{individual,schedule_c}')
on conflict (id) do nothing;

insert into public.document_requests (client_id, document_type_id, tax_year)
select '00000000-0000-4000-8000-0000000c1e01', id, case when requires_year then 2025 else null end
from public.document_types
where slug_for_filename in ('DriversLicense', 'W2', 'FederalReturn');
