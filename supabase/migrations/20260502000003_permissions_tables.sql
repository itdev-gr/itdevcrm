-- =============================================================================
-- Phase 2 migration: group_permissions, user_permissions, field_permissions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. group_permissions  (Layer 1: per-group default)
-- -----------------------------------------------------------------------------
create table public.group_permissions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  board text not null,
  action text not null,
  scope text not null check (scope in ('own', 'group', 'all')),
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, board, action)
);

create index group_permissions_group on public.group_permissions (group_id);
create index group_permissions_board_action on public.group_permissions (board, action);

create trigger group_permissions_set_updated_at
  before update on public.group_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. user_permissions  (Layer 2: per-user override)
-- -----------------------------------------------------------------------------
create table public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  board text not null,
  action text not null,
  scope text not null check (scope in ('own', 'group', 'all')),
  allowed boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, board, action)
);

create index user_permissions_user on public.user_permissions (user_id);

create trigger user_permissions_set_updated_at
  before update on public.user_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. field_permissions  (Layer 3: hidden / readonly per field)
-- -----------------------------------------------------------------------------
create table public.field_permissions (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('group', 'user')),
  scope_id uuid not null,
  table_name text not null,
  field_name text not null,
  mode text not null check (mode in ('hidden', 'readonly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id, table_name, field_name)
);

create index field_permissions_lookup on public.field_permissions (scope_type, scope_id);
create index field_permissions_table on public.field_permissions (table_name);

create trigger field_permissions_set_updated_at
  before update on public.field_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — all three tables: admins only
-- -----------------------------------------------------------------------------
alter table public.group_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.field_permissions enable row level security;

create policy group_permissions_select_authenticated
  on public.group_permissions for select
  to authenticated
  using (true);

create policy group_permissions_mutate_admin
  on public.group_permissions for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy user_permissions_select_self_or_admin
  on public.user_permissions for select
  to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());

create policy user_permissions_mutate_admin
  on public.user_permissions for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy field_permissions_select_authenticated
  on public.field_permissions for select
  to authenticated
  using (true);

create policy field_permissions_mutate_admin
  on public.field_permissions for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
