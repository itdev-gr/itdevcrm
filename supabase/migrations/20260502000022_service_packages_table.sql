-- =============================================================================
-- service_packages — admin-managed catalog of packages per service
-- =============================================================================
create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (
    service_type in ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting')
  ),
  code text not null,
  display_names jsonb not null,           -- {"en": "...", "el": "..."}
  default_one_time_amount numeric(12,2) default 0,
  default_monthly_amount numeric(12,2) default 0,
  setup_fee numeric(12,2) default 0,
  description text,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_type, code)
);

create index service_packages_service on public.service_packages (service_type, sort_order)
  where archived = false;

create trigger service_packages_set_updated_at
  before update on public.service_packages
  for each row execute function public.set_updated_at();

alter table public.service_packages enable row level security;

create policy service_packages_select_authenticated
  on public.service_packages for select
  to authenticated
  using (true);

create policy service_packages_mutate_admin
  on public.service_packages for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
