-- =============================================================================
-- user_tasks — freeform per-user tasks that appear on the home calendar
-- alongside scheduled leads. Each task has a due_at; completion is tracked
-- via completed_at (null = open).
-- =============================================================================

create table public.user_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text,
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_tasks_due_at on public.user_tasks (user_id, due_at);

create trigger user_tasks_set_updated_at
  before update on public.user_tasks
  for each row execute function public.set_updated_at();

alter table public.user_tasks enable row level security;

-- Members see their own tasks; admins see all (matches the calendar "All
-- team / My calendar" model).
create policy user_tasks_select on public.user_tasks
  for select to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());

-- Only the owner can mutate their tasks.
create policy user_tasks_mutate_own on public.user_tasks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Realtime so calendar updates without refresh when another tab edits.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.user_tasks';
  end if;
end $$;
