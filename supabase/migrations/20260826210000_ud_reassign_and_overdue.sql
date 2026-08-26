-- =============================================================================
-- 2026-08-26: Under Development pipeline — REASSIGNMENT + OVERDUE alerts
-- (the two remaining must-haves from the approved plan's Phase 4).
--
-- 1) Reassignment: changing a lead's owner transfers its OPEN cadence tasks to
--    the new owner (assignee + creator, so single-party resolve semantics keep
--    holding) and drops the new owner an in-app notification. Leads without
--    cadence tasks (the whole classic board) are a no-op.
--
-- 2) Overdue: a daily job notifies the assignee once when a cadence task goes
--    N days past due, and every OTHER admin once when it goes M days past due
--    (defaults 1 / 3 — thresholds live in ud_cadence_settings, admin-editable;
--    the Phase 5 Sales Automations page will expose them). Each task notifies
--    each level exactly once (stamped on the row), so re-runs are silent.
--
-- Everything is net-new; no existing function changes.
-- ROLLBACK: see block at the end.
-- =============================================================================

-- 1. Thresholds (singleton) ---------------------------------------------------

create table public.ud_cadence_settings (
  id boolean primary key default true check (id),
  overdue_rep_days int not null default 1 check (overdue_rep_days >= 0),
  overdue_admin_days int not null default 3 check (overdue_admin_days >= 0),
  updated_at timestamptz not null default now()
);

insert into public.ud_cadence_settings (id) values (true)
on conflict (id) do nothing;

create trigger ud_cadence_settings_set_updated_at
  before update on public.ud_cadence_settings
  for each row execute function public.set_updated_at();

alter table public.ud_cadence_settings enable row level security;
create policy ud_cadence_settings_select on public.ud_cadence_settings
  for select to authenticated using (true);
create policy ud_cadence_settings_update_admin on public.ud_cadence_settings
  for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- 2. Reassignment -------------------------------------------------------------

create or replace function public.ud_leads_transfer_cadence_tasks()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  moved int;
  v_titles text;
begin
  -- Owner removed entirely: leave the tasks with whoever had them.
  if new.owner_user_id is null then return new; end if;

  with moved_rows as (
    update public.user_tasks t
       set user_id = new.owner_user_id, created_by = new.owner_user_id
     where t.lead_id = new.id
       and t.cadence_run_id is not null
       and t.completed_at is null
       and t.user_id is distinct from new.owner_user_id
    returning t.title
  )
  select count(*), string_agg(title, ', ') into moved, v_titles from moved_rows;

  if moved > 0 and new.owner_user_id is distinct from auth.uid() then
    insert into public.notifications (user_id, type, payload)
    values (new.owner_user_id, 'cadence_task_transferred',
      jsonb_build_object(
        'parent_type', 'lead', 'parent_id', new.id,
        'lead_title', new.title, 'title', v_titles, 'count', moved));
  end if;
  return new;
end $$;

create trigger trg_ud_leads_transfer_cadence_tasks
  after update of owner_user_id on public.leads
  for each row when (old.owner_user_id is distinct from new.owner_user_id)
  execute function public.ud_leads_transfer_cadence_tasks();

-- 3. Overdue notifications ----------------------------------------------------

alter table public.user_tasks
  add column if not exists cadence_overdue_notified_at timestamptz,
  add column if not exists cadence_overdue_admin_notified_at timestamptz;

create or replace function public.ud_notify_overdue_tasks()
returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.ud_cadence_settings;
begin
  select * into s from public.ud_cadence_settings limit 1;
  if s is null then return; end if;

  -- Level 1: the assignee, once per task.
  with due as (
    update public.user_tasks t
       set cadence_overdue_notified_at = now()
      from public.leads l
     where l.id = t.lead_id
       and t.cadence_run_id is not null
       and t.completed_at is null
       and t.cadence_overdue_notified_at is null
       and t.due_at < now() - make_interval(days => s.overdue_rep_days)
    returning t.id, t.title, t.user_id, t.due_at, l.id as lead_id, l.title as lead_title
  )
  insert into public.notifications (user_id, type, payload)
  select d.user_id, 'cadence_task_overdue',
         jsonb_build_object(
           'parent_type', 'lead', 'parent_id', d.lead_id,
           'lead_title', d.lead_title, 'title', d.title, 'level', 'rep',
           'days_overdue', greatest(1, floor(extract(epoch from now() - d.due_at) / 86400))::int)
    from due d;

  -- Level 2: every OTHER active admin, once per task.
  with due2 as (
    update public.user_tasks t
       set cadence_overdue_admin_notified_at = now()
      from public.leads l
     where l.id = t.lead_id
       and t.cadence_run_id is not null
       and t.completed_at is null
       and t.cadence_overdue_admin_notified_at is null
       and t.due_at < now() - make_interval(days => s.overdue_admin_days)
    returning t.id, t.title, t.user_id, t.due_at, l.id as lead_id, l.title as lead_title
  )
  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'cadence_task_overdue',
         jsonb_build_object(
           'parent_type', 'lead', 'parent_id', d.lead_id,
           'lead_title', d.lead_title, 'title', d.title, 'level', 'admin',
           'days_overdue', greatest(1, floor(extract(epoch from now() - d.due_at) / 86400))::int,
           'owner_name', (select coalesce(nullif(pp.full_name, ''), pp.email)
                            from public.profiles pp where pp.user_id = d.user_id))
    from due2 d
    cross join lateral (
      select user_id from public.profiles
       where is_admin and is_active and archived = false and user_id <> d.user_id
    ) p;
end $$;

revoke execute on function public.ud_notify_overdue_tasks() from public, anon, authenticated;
revoke execute on function public.ud_leads_transfer_cadence_tasks() from public, anon, authenticated;

select cron.schedule('ud_overdue_notifications', '30 4 * * *',
  $$select public.ud_notify_overdue_tasks()$$);

-- ROLLBACK:
-- select cron.unschedule('ud_overdue_notifications');
-- drop function if exists public.ud_notify_overdue_tasks();
-- alter table public.user_tasks drop column if exists cadence_overdue_admin_notified_at,
--   drop column if exists cadence_overdue_notified_at;
-- drop trigger if exists trg_ud_leads_transfer_cadence_tasks on public.leads;
-- drop function if exists public.ud_leads_transfer_cadence_tasks();
-- drop table if exists public.ud_cadence_settings;
