-- 20260625160000_task_collaboration.sql
-- Task collaboration: started_at flag + dedicated task_comments table, both
-- scoped to the task's parties (creator + assignee + admin). Additive + reversible.

-- 1. started_at on both task tables.
alter table public.user_tasks     add column if not exists started_at timestamptz;
alter table public.assigned_tasks  add column if not exists started_at timestamptz;

-- 2. Notify the CREATOR when the assignee marks work started (NULL -> set).
create or replace function public.user_tasks_notify_started()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.started_at is null or old.started_at is not null then return new; end if;
  if new.created_by is null
     or new.created_by = new.user_id
     or new.created_by = auth.uid() then
    return new;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (new.created_by, 'task_started', jsonb_build_object(
    'task_kind', 'user_task',
    'task_id', new.id,
    'parent_type', 'user_task',
    'parent_id', new.id,
    'author_id', new.user_id,
    'title', new.title
  ));
  return new;
end $$;

drop trigger if exists user_tasks_notify_started on public.user_tasks;
create trigger user_tasks_notify_started
  after update of started_at on public.user_tasks
  for each row execute function public.user_tasks_notify_started();

create or replace function public.assigned_tasks_notify_started()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent_type text; v_parent_id uuid;
begin
  if new.started_at is null or old.started_at is not null then return new; end if;
  if new.created_by_user_id = new.assignee_user_id
     or new.created_by_user_id = auth.uid() then
    return new;
  end if;
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (new.created_by_user_id, 'task_started', jsonb_build_object(
    'task_kind', 'assigned_task',
    'task_id', new.id,
    'parent_type', v_parent_type,
    'parent_id', v_parent_id,
    'author_id', new.assignee_user_id,
    'title', new.title,
    'source_code', new.source_code
  ));
  return new;
end $$;

drop trigger if exists assigned_tasks_notify_started on public.assigned_tasks;
create trigger assigned_tasks_notify_started
  after update of started_at on public.assigned_tasks
  for each row execute function public.assigned_tasks_notify_started();

-- 3. Dedicated comments table, parties-only (NOT the open public.comments table).
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  user_task_id uuid references public.user_tasks(id) on delete cascade,
  assigned_task_id uuid references public.assigned_tasks(id) on delete cascade,
  author_user_id uuid not null references public.profiles(user_id),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  constraint task_comments_one_parent
    check ((user_task_id is not null) <> (assigned_task_id is not null))
);
create index if not exists task_comments_user_task
  on public.task_comments (user_task_id, created_at) where user_task_id is not null;
create index if not exists task_comments_assigned_task
  on public.task_comments (assigned_task_id, created_at) where assigned_task_id is not null;

-- 4. Party check (admin OR creator/assignee of the referenced task).
create or replace function public.is_task_party(p_user_task uuid, p_assigned_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_admin()
    or (p_user_task is not null and exists (
          select 1 from public.user_tasks ut
          where ut.id = p_user_task
            and (ut.user_id = auth.uid() or ut.created_by = auth.uid())))
    or (p_assigned_task is not null and exists (
          select 1 from public.assigned_tasks at2
          where at2.id = p_assigned_task
            and (at2.assignee_user_id = auth.uid() or at2.created_by_user_id = auth.uid())));
$$;

alter table public.task_comments enable row level security;

create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.is_task_party(user_task_id, assigned_task_id));

create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_task_party(user_task_id, assigned_task_id)
  );
-- No UPDATE/DELETE in v1 (append-only).

-- 5. Notify the OTHER party/parties on a new comment.
create or replace function public.task_comments_notify_other_party()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_creator uuid; v_assignee uuid; v_title text;
  v_parent_type text; v_parent_id uuid; v_source_code text; v_task_kind text;
begin
  if new.user_task_id is not null then
    v_task_kind := 'user_task'; v_parent_type := 'user_task'; v_parent_id := new.user_task_id;
    select created_by, user_id, title into v_creator, v_assignee, v_title
      from public.user_tasks where id = new.user_task_id;
  else
    v_task_kind := 'assigned_task';
    select created_by_user_id, assignee_user_id, title,
           case when deal_id is not null then 'deal' else 'job' end,
           coalesce(deal_id, job_id), source_code
      into v_creator, v_assignee, v_title, v_parent_type, v_parent_id, v_source_code
      from public.assigned_tasks where id = new.assigned_task_id;
  end if;

  -- notify the assignee unless they authored it
  if v_assignee is not null and v_assignee <> new.author_user_id then
    insert into public.notifications (user_id, type, payload)
    values (v_assignee, 'task_comment', jsonb_build_object(
      'task_kind', v_task_kind, 'task_id', coalesce(new.user_task_id, new.assigned_task_id),
      'parent_type', v_parent_type, 'parent_id', v_parent_id,
      'author_id', new.author_user_id, 'title', v_title,
      'snippet', left(new.body, 200), 'source_code', v_source_code));
  end if;
  -- notify the creator unless they authored it or are the same person as the assignee
  if v_creator is not null and v_creator <> new.author_user_id and v_creator is distinct from v_assignee then
    insert into public.notifications (user_id, type, payload)
    values (v_creator, 'task_comment', jsonb_build_object(
      'task_kind', v_task_kind, 'task_id', coalesce(new.user_task_id, new.assigned_task_id),
      'parent_type', v_parent_type, 'parent_id', v_parent_id,
      'author_id', new.author_user_id, 'title', v_title,
      'snippet', left(new.body, 200), 'source_code', v_source_code));
  end if;
  return new;
end $$;

drop trigger if exists task_comments_notify_other_party on public.task_comments;
create trigger task_comments_notify_other_party
  after insert on public.task_comments
  for each row execute function public.task_comments_notify_other_party();

-- 6. Realtime for live threads.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.task_comments';
  end if;
end $$;

-- ROLLBACK:
--   drop trigger if exists task_comments_notify_other_party on public.task_comments;
--   drop function if exists public.task_comments_notify_other_party();
--   alter publication supabase_realtime drop table if exists public.task_comments;
--   drop table if exists public.task_comments cascade;
--   drop function if exists public.is_task_party(uuid, uuid);
--   drop trigger if exists assigned_tasks_notify_started on public.assigned_tasks;
--   drop function if exists public.assigned_tasks_notify_started();
--   drop trigger if exists user_tasks_notify_started on public.user_tasks;
--   drop function if exists public.user_tasks_notify_started();
--   alter table public.assigned_tasks drop column if exists started_at;
--   alter table public.user_tasks drop column if exists started_at;
