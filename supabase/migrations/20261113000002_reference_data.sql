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
