-- =============================================================================
-- assigned_tasks — work-handoff tasks created from a deal or a job and
-- assigned to another user. Surfaced on the Home page (open only) and on the
-- source deal/job under a "Tasks" tab (all statuses kept forever).
--
-- Rules enforced here:
--   * Exactly one of deal_id / job_id is set per row.
--   * client_id and source_code are denormalised from the source (trigger).
--   * Inserts allowed only for admins, accounting members, or any tech group.
--   * Resolves notify the creator; assignments notify the assignee.
-- =============================================================================

create table public.assigned_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  deal_id uuid references public.deals(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_code text,
  assignee_user_id uuid not null references public.profiles(user_id) on delete restrict,
  created_by_user_id uuid not null references public.profiles(user_id) on delete restrict,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assigned_tasks_one_source
    check ((deal_id is not null) <> (job_id is not null))
);

create index assigned_tasks_assignee_open
  on public.assigned_tasks (assignee_user_id, created_at desc)
  where status = 'open';

create index assigned_tasks_deal
  on public.assigned_tasks (deal_id, created_at desc)
  where deal_id is not null;

create index assigned_tasks_job
  on public.assigned_tasks (job_id, created_at desc)
  where job_id is not null;

create trigger assigned_tasks_set_updated_at
  before update on public.assigned_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Denormalise client_id + source_code from the deal or job referenced.
-- Runs BEFORE INSERT and overrides any client_id/source_code the caller sent,
-- so the row is always consistent with the source.
-- ---------------------------------------------------------------------------
create or replace function public.assigned_tasks_populate_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  c_code text;
begin
  if new.deal_id is not null then
    select client_id, code into c_id, c_code
      from public.deals where id = new.deal_id;
  elsif new.job_id is not null then
    select client_id, code into c_id, c_code
      from public.jobs where id = new.job_id;
  end if;
  if c_id is null then
    raise exception 'assigned_tasks: source deal/job not found';
  end if;
  new.client_id := c_id;
  new.source_code := c_code;
  return new;
end $$;

drop trigger if exists assigned_tasks_populate_source on public.assigned_tasks;
create trigger assigned_tasks_populate_source
  before insert on public.assigned_tasks
  for each row execute function public.assigned_tasks_populate_source();

-- ---------------------------------------------------------------------------
-- Stamp resolved_at / resolved_by automatically when status flips to 'resolved'
-- and unstamp them when it flips back to 'open' (admin reopen path).
-- ---------------------------------------------------------------------------
create or replace function public.assigned_tasks_stamp_resolved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then
    new.resolved_at := now();
    new.resolved_by_user_id := auth.uid();
  elsif new.status = 'open' and (old.status is distinct from 'open') then
    new.resolved_at := null;
    new.resolved_by_user_id := null;
  end if;
  return new;
end $$;

drop trigger if exists assigned_tasks_stamp_resolved on public.assigned_tasks;
create trigger assigned_tasks_stamp_resolved
  before update of status on public.assigned_tasks
  for each row execute function public.assigned_tasks_stamp_resolved();

-- ---------------------------------------------------------------------------
-- Notifications fan-out.
--   on insert → 'task_assigned' for the assignee (suppressed if self-assign)
--   on resolve → 'task_resolved' for the creator (suppressed if creator==resolver)
-- Payload mirrors the existing 'mention' shape so NotificationsColumn can
-- read parent_type/parent_id with the helpers it already has.
-- ---------------------------------------------------------------------------
create or replace function public.assigned_tasks_notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_type text;
  parent_id uuid;
begin
  if new.assignee_user_id = new.created_by_user_id then
    return new;
  end if;
  if new.deal_id is not null then
    parent_type := 'deal'; parent_id := new.deal_id;
  else
    parent_type := 'job';  parent_id := new.job_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.assignee_user_id,
    'task_assigned',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', parent_type,
      'parent_id', parent_id,
      'author_id', new.created_by_user_id,
      'title', new.title,
      'source_code', new.source_code
    )
  );
  return new;
end $$;

drop trigger if exists assigned_tasks_notify_assignee on public.assigned_tasks;
create trigger assigned_tasks_notify_assignee
  after insert on public.assigned_tasks
  for each row execute function public.assigned_tasks_notify_assignee();

create or replace function public.assigned_tasks_notify_creator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_type text;
  parent_id uuid;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  if new.created_by_user_id = coalesce(new.resolved_by_user_id, auth.uid()) then
    return new;
  end if;
  if new.deal_id is not null then
    parent_type := 'deal'; parent_id := new.deal_id;
  else
    parent_type := 'job';  parent_id := new.job_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.created_by_user_id,
    'task_resolved',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', parent_type,
      'parent_id', parent_id,
      'author_id', coalesce(new.resolved_by_user_id, auth.uid()),
      'title', new.title,
      'source_code', new.source_code
    )
  );
  return new;
end $$;

drop trigger if exists assigned_tasks_notify_creator on public.assigned_tasks;
create trigger assigned_tasks_notify_creator
  after update of status on public.assigned_tasks
  for each row execute function public.assigned_tasks_notify_creator();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.assigned_tasks enable row level security;

create policy assigned_tasks_select on public.assigned_tasks
  for select to authenticated
  using (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  );

create policy assigned_tasks_insert on public.assigned_tasks
  for insert to authenticated
  with check (
    auth.uid() = created_by_user_id
    and (
      public.current_user_is_admin()
      or exists (
        select 1
          from public.user_groups ug
          join public.groups g on g.id = ug.group_id
         where ug.user_id = auth.uid()
           and g.code in (
             'accounting',
             'web_seo', 'local_seo', 'web_dev',
             'social_media', 'ai_seo', 'hosting', 'ads'
           )
      )
    )
  );

create policy assigned_tasks_update on public.assigned_tasks
  for update to authenticated
  using (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  )
  with check (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  );

create policy assigned_tasks_delete on public.assigned_tasks
  for delete to authenticated
  using (
    auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'assigned_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.assigned_tasks';
  end if;
end $$;
