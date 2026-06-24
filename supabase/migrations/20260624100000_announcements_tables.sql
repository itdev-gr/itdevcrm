-- =============================================================================
-- Admin broadcast announcements: one row per announcement, group targeting via
-- announcement_targets, per-user dismissal via announcement_dismissals.
-- =============================================================================
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  severity    text not null default 'info' check (severity in ('info','warning')),
  target_all  boolean not null default false,
  expires_at  timestamptz,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.announcement_targets (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  group_id        uuid not null references public.groups(id) on delete cascade,
  primary key (announcement_id, group_id)
);
create index if not exists announcement_targets_group_idx on public.announcement_targets(group_id);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_targets enable row level security;
alter table public.announcement_dismissals enable row level security;

-- Admins manage + read the tables directly (for the management list).
-- Non-admins never touch these tables directly; they use the security-definer
-- RPCs (which bypass RLS).
create policy announcements_admin_all on public.announcements
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy announcement_targets_admin_all on public.announcement_targets
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- A user can see their own dismissal rows (admins see all). Inserts happen only
-- through dismiss_announcement (security definer).
create policy announcement_dismissals_select_own on public.announcement_dismissals
  for select using (user_id = auth.uid() or public.current_user_is_admin());

-- Rollback:
-- drop table if exists public.announcement_dismissals;
-- drop table if exists public.announcement_targets;
-- drop table if exists public.announcements;
