-- =============================================================================
-- Dual-resolve AI summary pipeline — async plumbing (Task 5).
-- Spec: docs/superpowers/specs/2026-07-16-dual-resolve-task-summary-design.md
--
-- When a task closes fully (both sides resolved → terminal transition), an
-- AFTER-UPDATE enqueue trigger drops a row into task_summary_outbox. A
-- statement-level pulse fires the summarize-task Edge Function immediately (with
-- a 10-minute cron backstop), which drains the outbox via claim_task_summaries()
-- (concurrency-safe, mirrors the email pipeline) and posts a Greek AI summary as
-- a comment routed by task_comment_target(). The Edge Function itself is Task 6.
--
-- Mirrors the email pipeline: claim/recover-stale (20260625150000),
-- instant-send pulse (20260625150002), drain cron (20260602000002).
--
-- ROLLBACK (run manually to roll back this migration):
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'task-summary-drain') then
--       perform cron.unschedule('task-summary-drain');
--     end if;
--   end $$;
--   drop trigger if exists task_summary_pulse on public.task_summary_outbox;
--   drop trigger if exists assigned_tasks_enqueue_summary on public.assigned_tasks;
--   drop trigger if exists user_tasks_enqueue_summary on public.user_tasks;
--   drop function if exists public.task_summary_pulse();
--   drop function if exists public.enqueue_task_summary();
--   drop function if exists public.claim_task_summaries(int);
--   drop function if exists public.task_comment_target(text, uuid);
--   drop table if exists public.task_summary_outbox;
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- 1) Outbox. Service-role only: RLS on with NO policies (the summarize-task Edge
--    Function drains it with the service role, which bypasses RLS).
create table public.task_summary_outbox (
  id         uuid primary key default gen_random_uuid(),
  task_kind  text not null check (task_kind in ('user','assigned')),
  task_id    uuid not null,
  status     text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts   int  not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz
);

alter table public.task_summary_outbox enable row level security;

-- Index the claim's hot predicate (status = 'pending' / 'sending').
create index task_summary_outbox_status_idx on public.task_summary_outbox (status);

revoke all on public.task_summary_outbox from anon, authenticated;

-- 2) Atomic, concurrency-safe claim — mirrors claim_email_outbox +
--    recover_stale_email_claims (20260625150000), folded into one call.
create or replace function public.claim_task_summaries(p_limit int)
returns setof public.task_summary_outbox
language sql
security definer
set search_path to 'public'
as $$
  -- a) Recover rows stuck in 'sending' (fn crashed after claim, before mark)
  --    back to 'pending' — same 5-minute staleness window as
  --    recover_stale_email_claims. Keyed off claimed_at (the actual claim time),
  --    NOT created_at: a retried or cron-drained row keeps its old created_at, so
  --    keying on created_at would recover a freshly re-claimed row mid-flight and
  --    hand it to a second concurrent drain (duplicate summary + doubled spend).
  --    Null claimed_at on recovery so a recovered row isn't instantly re-stale.
  update public.task_summary_outbox
     set status = 'pending', claimed_at = null
   where status = 'sending'
     and claimed_at is not null
     and claimed_at < now() - interval '5 minutes';

  -- b) Give up on rows that have exhausted their retries. The claim below caps
  --    at attempts < 5 (identical to claim_email_outbox); flipping the loser to
  --    'failed' here stops it being scanned forever.
  update public.task_summary_outbox
     set status = 'failed'
   where status = 'pending' and attempts >= 5;

  -- c) Claim the next batch. FOR UPDATE SKIP LOCKED => concurrent drains take
  --    disjoint row sets; the 'sending' flip + attempts bump mirror
  --    claim_email_outbox exactly.
  update public.task_summary_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.task_summary_outbox
      where status = 'pending' and attempts < 5
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning o.*;
$$;

revoke all on function public.claim_task_summaries(int) from public, anon, authenticated;

-- 3) Comment-routing helper. Returns the (parent_type, parent_id) the summary
--    comment should be posted to, or NO row when the task has no linkable parent
--    (e.g. an unlinked user task).
--
--    NOTE: the assigned-task CASE below intentionally DUPLICATES the routing in
--    assigned_tasks_comment_on_resolve (20260716100000) — keep the two in sync.
--    The user-task branch extends user_tasks_comment_on_resolve (20260709170000,
--    client/lead only) with deal_id/job_id fallbacks per the dual-resolve spec.
create or replace function public.task_comment_target(p_kind text, p_task_id uuid)
returns table(parent_type text, parent_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deal uuid; v_job uuid; v_client uuid; v_lead uuid; v_st text; v_jdeal uuid;
begin
  if p_kind = 'assigned' then
    select a.deal_id, a.job_id into v_deal, v_job
      from public.assigned_tasks a where a.id = p_task_id;
    if v_deal is not null then
      return query select 'deal'::text, v_deal;
      return;
    elsif v_job is not null then
      select j.service_type, j.deal_id into v_st, v_jdeal
        from public.jobs j where j.id = v_job;
      if v_st is null then return; end if;   -- job missing => no linkable parent
      if    v_st = 'web_dev'                         then return query select 'deal_dev'::text,    v_jdeal;
      elsif v_st in ('web_seo','local_seo','ai_seo') then return query select 'deal_seo'::text,    v_jdeal;
      elsif v_st = 'ads'                             then return query select 'deal_ads'::text,    v_jdeal;
      elsif v_st = 'social_media'                    then return query select 'deal_social'::text, v_jdeal;
      else                                                return query select 'job'::text,         v_job;
      end if;
      return;
    end if;
    return;  -- assigned task with neither deal nor job => no linkable parent
  elsif p_kind = 'user' then
    select u.client_id, u.lead_id, u.deal_id, u.job_id
      into v_client, v_lead, v_deal, v_job
      from public.user_tasks u where u.id = p_task_id;
    if    v_client is not null then return query select 'client'::text, v_client;
    elsif v_lead   is not null then return query select 'lead'::text,   v_lead;
    elsif v_deal   is not null then return query select 'deal'::text,   v_deal;
    elsif v_job    is not null then return query select 'job'::text,    v_job;
    end if;
    return;  -- unlinked user task => no row
  end if;
  return;  -- unknown kind => no row
end $$;

revoke all on function public.task_comment_target(text, uuid) from public, anon, authenticated;

-- 4) Enqueue triggers. WHEN clauses are byte-identical to the dual-resolve guard
--    triggers (20260716200000), so a row is enqueued exactly once per full close.
create or replace function public.enqueue_task_summary() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.task_summary_outbox (task_kind, task_id)
  values (tg_argv[0]::text, new.id);
  return null;
end $$;

create trigger assigned_tasks_enqueue_summary
  after update on public.assigned_tasks
  for each row when (old.status = 'open' and new.status = 'resolved')
  execute function public.enqueue_task_summary('assigned');

create trigger user_tasks_enqueue_summary
  after update on public.user_tasks
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function public.enqueue_task_summary('user');

-- 5) Instant-send pulse — copies email_outbox_pulse (20260625150002) exactly:
--    same vault reads, same schema-qualified net.http_post, same best-effort
--    begin…exception wrapper so a pulse failure never rolls back the caller.
create or replace function public.task_summary_pulse()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Best-effort: the row is already enqueued and the 10-minute cron will still
  -- drain it — never let a pulse error roll back the resolving transaction.
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/summarize-task',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'task_summary_secret')
      ),
      body := jsonb_build_object('drain', true)
    );
  exception when others then
    null;
  end;
  return null;
end $function$;

-- Statement-level: one pulse per insert statement (a drain handles many rows).
drop trigger if exists task_summary_pulse on public.task_summary_outbox;
create trigger task_summary_pulse
after insert on public.task_summary_outbox
for each statement
execute function public.task_summary_pulse();

-- 6) Backstop cron — mirrors the email drain cron (20260602000002) but every
--    10 minutes, posting the SAME drain call as the pulse (endpoint + auth +
--    body identical) so summarize-task authenticates uniformly on both paths.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'task-summary-drain') then
    perform cron.unschedule('task-summary-drain');
  end if;
  perform cron.schedule(
    'task-summary-drain',
    '*/10 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/summarize-task',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'task_summary_secret')
        ),
        body := jsonb_build_object('drain', true)
      );
    $cron$
  );
end $$;

-- 7) Post-asserts — fail the migration loudly if anything is off.
do $$
declare n int;
begin
  if not exists (select 1 from pg_tables
                 where schemaname = 'public' and tablename = 'task_summary_outbox') then
    raise exception 'task_summary_outbox missing';
  end if;
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('claim_task_summaries','task_comment_target',
                        'task_summary_pulse','enqueue_task_summary');
  if n < 4 then raise exception 'expected 4 task-summary functions, found %', n; end if;
  if not exists (select 1 from pg_trigger where tgname = 'task_summary_pulse') then
    raise exception 'task_summary_pulse trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'assigned_tasks_enqueue_summary') then
    raise exception 'assigned_tasks_enqueue_summary trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_tasks_enqueue_summary') then
    raise exception 'user_tasks_enqueue_summary trigger missing'; end if;
  if not exists (select 1 from cron.job where jobname = 'task-summary-drain') then
    raise exception 'task-summary-drain cron missing'; end if;
end $$;
