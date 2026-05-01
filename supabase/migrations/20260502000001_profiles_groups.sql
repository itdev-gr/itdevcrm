-- =============================================================================
-- Phase 1 migration: profiles, groups, user_groups + RLS + seed
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles  (extends auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  avatar_url text,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'el')),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_unique on public.profiles (lower(email));
create index profiles_is_admin on public.profiles (is_admin) where is_admin = true;
create index profiles_is_active on public.profiles (is_active) where is_active = true;

-- -----------------------------------------------------------------------------
-- 2. groups  (operational departments)
-- -----------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_names jsonb not null,    -- {"en": "Sales", "el": "Πωλήσεις"}
  parent_label text,               -- 'Sales' | 'Accounting' | 'Technical' (UI grouping)
  position int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. user_groups  (many-to-many)
-- -----------------------------------------------------------------------------
create table public.user_groups (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index user_groups_group_id on public.user_groups (group_id);

-- -----------------------------------------------------------------------------
-- 4. updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. auth.users → profiles trigger
--    When a user is created in Supabase Auth, automatically insert a profiles row.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, full_name, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true)
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 6. is_admin helper (for RLS)
-- -----------------------------------------------------------------------------
create or replace function public.current_user_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_admin from public.profiles where user_id = auth.uid()),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- 7. RLS — profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_self_or_admin
  on public.profiles for select
  using (auth.uid() = user_id or public.current_user_is_admin());

create policy profiles_update_self_limited
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy profiles_update_admin
  on public.profiles for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- INSERT only via the trigger; no direct INSERT policy needed (trigger runs as security definer).
-- DELETE not allowed (we soft-delete via archived).

-- Column-level grants: prevent self from changing privileged columns.
revoke update (is_admin, is_active, archived, archived_at, archived_by, archived_reason)
  on public.profiles from authenticated;
grant update (full_name, avatar_url, must_change_password, preferred_locale, email)
  on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- -----------------------------------------------------------------------------
-- 8. RLS — groups
-- -----------------------------------------------------------------------------
alter table public.groups enable row level security;

create policy groups_select_authenticated
  on public.groups for select
  to authenticated
  using (archived = false);

create policy groups_mutate_admin
  on public.groups for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- -----------------------------------------------------------------------------
-- 9. RLS — user_groups
-- -----------------------------------------------------------------------------
alter table public.user_groups enable row level security;

create policy user_groups_select_self_or_admin
  on public.user_groups for select
  to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());

create policy user_groups_mutate_admin
  on public.user_groups for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- -----------------------------------------------------------------------------
-- 10. Seed groups
-- -----------------------------------------------------------------------------
insert into public.groups (code, display_names, parent_label, position) values
  ('sales',        '{"en": "Sales",        "el": "Πωλήσεις"}'::jsonb,        'Sales',      10),
  ('accounting',   '{"en": "Accounting",   "el": "Λογιστήριο"}'::jsonb,      'Accounting', 20),
  ('web_seo',      '{"en": "Web SEO",      "el": "SEO Ιστού"}'::jsonb,        'Technical',  30),
  ('local_seo',    '{"en": "Local SEO",    "el": "Τοπικό SEO"}'::jsonb,       'Technical',  40),
  ('web_dev',      '{"en": "Web Dev",      "el": "Ανάπτυξη Ιστού"}'::jsonb,   'Technical',  50),
  ('social_media', '{"en": "Social Media", "el": "Social Media"}'::jsonb,     'Technical',  60)
on conflict (code) do nothing;
