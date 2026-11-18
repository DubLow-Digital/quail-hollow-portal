-- Document types can ask for the front and back of a card (a driver's license, an insurance
-- card). When the setting is on, the portal adds "(front and back)" to the name clients see,
-- tells them to send both sides, and Scan document asks for the front, then the back. When it
-- is off, the portal never mentions front and back.
alter table public.document_types
  add column requires_front_back boolean not null default false;

grant select (requires_front_back) on public.document_types to authenticated;

-- The starting Driver's License type said "front and back" in its name and instructions. That
-- wording now comes from the setting, so it keeps asking for both sides (Aleida can turn it
-- off) and the text stops repeating it. Only the original wording is changed; a name or
-- instructions Aleida has edited stay as she wrote them.
update public.document_types
set requires_front_back = true
where name = 'Driver''s License (front and back)';

update public.document_types
set name = 'Driver''s License'
where name = 'Driver''s License (front and back)'
  and not exists (select 1 from public.document_types where name = 'Driver''s License');

update public.document_types
set description = 'A clear picture of your current driver''s license or state ID.'
where description = 'A clear picture of the front and back of your current driver''s license or state ID. Use "Scan document" to capture both sides as one file.';
