-- Follow-up to 20260717150000_task_auto_close (final-review finding): the
-- auto-close terminal UPDATE also fired the human-close triggers, producing
-- (a) duplicate task_resolved bells with a misattributed author and (b) a
-- "✅ Task resolved" thread comment authored by the assignee who never acted.
-- Fix: auto_close_stale_tasks() sets a second txn-local GUC
-- (app.task_auto_close) and the 4 human-close trigger fns early-return when
-- it is set — the task_auto_closed notification and the AI summary comment
-- carry the auto-close story instead. Bodies below reproduce the LIVE prod
-- definitions (read via pg_get_functiondef 2026-07-17) plus the guard line.

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
  -- Marks this txn as an AUTO close: the human-close notify/comment triggers
  -- early-return on it (task_auto_closed + AI summary tell the story instead).
  perform set_config('app.task_auto_close', '1', true);

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

create or replace function public.user_tasks_notify_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
begin
  if coalesce(current_setting('app.task_auto_close', true), '') = '1' then
    return new;
  end if;
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  if new.created_by is not null
     and new.created_by <> new.user_id
     and new.created_by <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.created_by, 'task_resolved', jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', v_actor,
      'title', new.title));
  end if;
  if new.user_id <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.user_id, 'task_resolved', jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', v_actor,
      'title', new.title));
  end if;
  return new;
end $$;

create or replace function public.assigned_tasks_notify_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
  v_payload jsonb;
begin
  if coalesce(current_setting('app.task_auto_close', true), '') = '1' then
    return new;
  end if;
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  v_actor := coalesce(new.resolved_by_user_id, auth.uid());
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  v_payload := jsonb_build_object(
    'task_kind', 'assigned_task',
    'task_id', new.id,
    'parent_type', v_parent_type,
    'parent_id', v_parent_id,
    'author_id', v_actor,
    'title', new.title,
    'source_code', new.source_code,
    'target_job_id', v_target_job_id);
  if new.created_by_user_id is not null
     and new.created_by_user_id <> new.assignee_user_id
     and (v_actor is null or new.created_by_user_id <> v_actor) then
    insert into public.notifications (user_id, type, payload)
    values (new.created_by_user_id, 'task_resolved', v_payload);
  end if;
  if v_actor is null or new.assignee_user_id <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.assignee_user_id, 'task_resolved', v_payload);
  end if;
  return new;
end $$;

create or replace function public.user_tasks_comment_on_resolve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_type text; v_id uuid;
begin
  if coalesce(current_setting('app.task_auto_close', true), '') = '1' then
    return new;
  end if;
  if new.client_id is not null then v_type := 'client'; v_id := new.client_id;
  elsif new.lead_id is not null then v_type := 'lead'; v_id := new.lead_id;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(auth.uid(), new.user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'user:' || new.id);
  return new;
end $$;

create or replace function public.assigned_tasks_comment_on_resolve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_type text; v_id uuid; v_st text; v_deal uuid;
begin
  if coalesce(current_setting('app.task_auto_close', true), '') = '1' then
    return new;
  end if;
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    elsif v_st = 'ads' then v_type := 'deal_ads'; v_id := v_deal;
    elsif v_st = 'social_media' then v_type := 'deal_social'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.resolved_by_user_id, auth.uid(), new.assignee_user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'assigned:' || new.id);
  return new;
end $$;

-- Rollback: re-apply the 5 function bodies from prod backups / prior
-- migrations without the app.task_auto_close guard lines (the guard is the
-- only addition; auto_close_stale_tasks additionally gains one set_config).
