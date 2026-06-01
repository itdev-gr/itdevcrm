create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name_en text not null,
  name_el text not null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

alter table public.expense_categories enable row level security;

create policy expense_categories_select on public.expense_categories
  for select to authenticated using (true);

create policy expense_categories_mutate on public.expense_categories
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

insert into public.expense_categories (key, name_en, name_el, sort_order) values
  ('salaries',        'Salaries',          'Μισθοί',                          10),
  ('freelancers',     'Freelancers',       'Εξωτερικοί συνεργάτες',           20),
  ('rent',            'Rent',              'Ενοίκιο',                         30),
  ('utilities',       'Utilities',         'Λογαριασμοί κοινής ωφέλειας',     40),
  ('software',        'Software',          'Λογισμικό',                       50),
  ('hosting_domains', 'Hosting & Domains', 'Φιλοξενία & Domains',             60),
  ('ads_spend',       'Ads spend',         'Διαφημιστική δαπάνη',             70),
  ('equipment',       'Equipment',         'Εξοπλισμός',                      80),
  ('taxes_vat',       'Taxes / VAT',       'Φόροι / ΦΠΑ',                     90),
  ('accountant_fees', 'Accountant fees',   'Λογιστικά',                      100),
  ('bank_fees',       'Bank fees',         'Τραπεζικά έξοδα',                110),
  ('marketing',       'Marketing',         'Marketing',                      120),
  ('training',        'Training',          'Εκπαίδευση',                     130),
  ('travel',          'Travel',            'Μετακινήσεις',                   140),
  ('other',           'Other',             'Άλλο',                           150);

-- ROLLBACK:
-- drop table if exists public.expense_categories cascade;
