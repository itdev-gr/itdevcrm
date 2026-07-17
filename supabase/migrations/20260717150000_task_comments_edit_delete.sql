-- =============================================================================
-- Let authors (and admins) EDIT + soft-DELETE their own task_comments.
--
-- task_comments shipped append-only (INSERT + SELECT policies only). This adds
-- the same edit/soft-delete model the general `comments` table already has:
--   • updated_at column + touch trigger  → drives an "edited" indicator
--   • archived/archived_at/archived_by    → soft-delete (recoverable), the UI
--     hides archived rows; nothing is hard-deleted
--   • UPDATE + DELETE RLS keyed on author_user_id = auth.uid() OR admin
--   • REPLICA IDENTITY FULL so realtime UPDATE/DELETE events carry the row
--
-- ROLLBACK:
--   drop policy if exists task_comments_update_self_or_admin on public.task_comments;
--   drop policy if exists task_comments_delete_self_or_admin on public.task_comments;
--   drop trigger if exists task_comments_set_updated_at on public.task_comments;
--   drop function if exists public.task_comments_set_updated_at();
--   alter table public.task_comments replica identity default;
--   alter table public.task_comments
--     drop column if exists updated_at,
--     drop column if exists archived,
--     drop column if exists archived_at,
--     drop column if exists archived_by;
-- =============================================================================

-- 1. columns (mirror the general comments soft-delete + edited model)
alter table public.task_comments
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists archived    boolean     not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(user_id);

-- 2. stamp updated_at on every edit
create or replace function public.task_comments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at
  before update on public.task_comments
  for each row execute function public.task_comments_set_updated_at();

-- 3. author-or-admin UPDATE (covers both body edits and the soft-delete UPDATE)
drop policy if exists task_comments_update_self_or_admin on public.task_comments;
create policy task_comments_update_self_or_admin on public.task_comments
  for update
  using (author_user_id = auth.uid() or public.current_user_is_admin())
  with check (author_user_id = auth.uid() or public.current_user_is_admin());

-- 4. author-or-admin hard DELETE (UI uses soft-delete; this enables admin purge)
drop policy if exists task_comments_delete_self_or_admin on public.task_comments;
create policy task_comments_delete_self_or_admin on public.task_comments
  for delete
  using (author_user_id = auth.uid() or public.current_user_is_admin());

-- 5. realtime: emit the full old/new row on UPDATE/DELETE so other clients refresh
alter table public.task_comments replica identity full;
