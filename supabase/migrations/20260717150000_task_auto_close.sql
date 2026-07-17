-- Auto-close half-resolved tasks with no activity for 7 days (owner decision
-- 2026-07-17): exactly one side stamped + updated_at AND task comments quiet
-- for 7 days → stamp the missing side (its *_resolved_by stays NULL = closed
-- automatically), close the task, notify both parties in-app. The existing
-- enqueue_task_summary AFTER-UPDATE triggers fire on the open→terminal
-- transition, so the AI summary pipeline runs unchanged.

create or replace function public.auto_close_stale_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '7 days';
begin
  -- Same txn-local GUC the resolve/unresolve RPCs set; lets the terminal
  -- guard triggers accept these UPDATEs.
  perform set_config('app.task_resolve_rpc', '1', true);

  with cand as (
    select t.id, t.title, t.user_id as assignee_id, t.created_by as creator_id
    from public.user_tasks t
    where t.completed_at is null
      and (t.creator_resolved_at is null) <> (t.assignee_resolved_at is null)
      and greatest(
            t.updated_at,
            coalesce((select max(c.created_at) from public.task_comments c
                      where c.user_task_id = t.id), t.updated_at)
          ) < v_cutoff
  ), closed as (
    update public.user_tasks t
    set creator_resolved_at  = coalesce(t.creator_resolved_at,  now()),
        assignee_resolved_at = coalesce(t.assignee_resolved_at, now()),
        completed_at = now()
    from cand
    where t.id = cand.id
    returning t.id, t.title, cand.assignee_id, cand.creator_id
  )
  insert into public.notifications (user_id, type, payload)
  select p.uid, 'task_auto_closed',
         jsonb_build_object('task_kind', 'user_task', 'task_id', c.id, 'title', c.title)
  from closed c
  cross join lateral (
    select distinct u.uid
    from unnest(array[c.assignee_id, c.creator_id]) as u(uid)
    where u.uid is not null
  ) p;

  with cand as (
    select t.id, t.title, t.assignee_user_id as assignee_id, t.created_by_user_id as creator_id
    from public.assigned_tasks t
    where t.status = 'open'
      and (t.creator_resolved_at is null) <> (t.assignee_resolved_at is null)
      and greatest(
            t.updated_at,
            coalesce((select max(c.created_at) from public.task_comments c
                      where c.assigned_task_id = t.id), t.updated_at)
          ) < v_cutoff
  ), closed as (
    update public.assigned_tasks t
    set creator_resolved_at  = coalesce(t.creator_resolved_at,  now()),
        assignee_resolved_at = coalesce(t.assignee_resolved_at, now()),
        status = 'resolved',
        resolved_at = now()
    from cand
    where t.id = cand.id
    returning t.id, t.title, cand.assignee_id, cand.creator_id
  )
  insert into public.notifications (user_id, type, payload)
  select p.uid, 'task_auto_closed',
         jsonb_build_object('task_kind', 'assigned_task', 'task_id', c.id, 'title', c.title)
  from closed c
  cross join lateral (
    select distinct u.uid
    from unnest(array[c.assignee_id, c.creator_id]) as u(uid)
    where u.uid is not null
  ) p;
end $$;

-- Nightly/cron-only helper: no client role may call it (grant-boundary rule).
revoke all on function public.auto_close_stale_tasks() from public, anon, authenticated;

select cron.schedule(
  'auto_close_stale_tasks',
  '35 2 * * *',
  'select public.auto_close_stale_tasks();'
);

-- Rollback:
--   select cron.unschedule('auto_close_stale_tasks');
--   drop function if exists public.auto_close_stale_tasks();
