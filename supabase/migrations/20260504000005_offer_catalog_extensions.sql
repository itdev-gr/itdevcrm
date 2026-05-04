-- Extend service_packages to carry the offer-system fields and allow Ads.
alter table public.service_packages
  drop constraint if exists service_packages_service_type_check;
alter table public.service_packages
  add constraint service_packages_service_type_check
  check (service_type in
    ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads'));

alter table public.service_packages
  add column if not exists subtitle text;
alter table public.service_packages
  add column if not exists is_active boolean not null default true;

-- description already exists. (Postgres text has no length limit.)

-- Sub-products live in their own table so the catalog admin can reorder /
-- price them independently of the parent package.
create table if not exists public.service_subpackages (
  id uuid primary key default gen_random_uuid(),
  parent_package_id uuid not null references public.service_packages(id) on delete cascade,
  code text not null,
  display_names jsonb not null,
  description text,
  price numeric(12,2) not null default 0,
  sort_order int not null default 0,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_package_id, code)
);

create trigger service_subpackages_set_updated_at
  before update on public.service_subpackages
  for each row execute function public.set_updated_at();

alter table public.service_subpackages enable row level security;

create policy service_subpackages_select_authenticated
  on public.service_subpackages for select to authenticated using (true);

create policy service_subpackages_mutate_admin
  on public.service_subpackages for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- New ads group (mirrors seeded ai_seo / hosting groups). Permissions left
-- empty until the ads board ships.
insert into public.groups (code, display_names, parent_label, position)
values ('ads', '{"en":"Ads","el":"Διαφήμιση"}'::jsonb, 'Technical', 90)
on conflict (code) do nothing;
