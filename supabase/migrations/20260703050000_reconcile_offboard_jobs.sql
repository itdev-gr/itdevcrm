-- 2026-07-03: Self-healing safety net — a service job can never stay "off-board"
-- (stage_id NULL) on a Paid-In-Full deal, which makes it invisible on its kanban
-- board (as happened once with 005071-LOCALSEO).
--
-- Job placement normally runs when a deal transitions INTO paid_in_full. If a job
-- ends up off-board afterwards (any edge — a service added to an already-paid deal,
-- a stage cleared by some path, etc.), this reconciler places it into its board's
-- first stage. It ONLY touches jobs whose stage_id IS NULL, so it never moves a job
-- the team has already placed — idempotent and safe by construction. Billing-only
-- records (the AI-SEO parent) are intentionally off-board and are excluded.

create or replace function public.reconcile_offboard_jobs()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_stage uuid; n int := 0;
begin
  for r in
    select j.id, j.service_type
      from public.jobs j
      join public.deals d on d.id = j.deal_id
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived
       and j.status = 'active'
       and coalesce(j.billing_only, false) = false
       and j.stage_id is null
       and ps.code = 'paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads')
  loop
    -- Place on the job's own board, in its first (entry) stage.
    select id into v_stage from public.pipeline_stages
      where board = r.service_type and not archived order by position limit 1;
    if v_stage is not null then
      update public.jobs set stage_id = v_stage where id = r.id and stage_id is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_offboard_jobs() from public, anon, authenticated;
grant execute on function public.reconcile_offboard_jobs() to service_role;

-- Run every 15 minutes (cheap when there is nothing to place).
do $$ begin perform cron.unschedule('reconcile_offboard_jobs'); exception when others then null; end $$;
select cron.schedule('reconcile_offboard_jobs', '*/15 * * * *',
  $$ select public.reconcile_offboard_jobs(); $$);

-- ROLLBACK:
--   select cron.unschedule('reconcile_offboard_jobs');
--   drop function if exists public.reconcile_offboard_jobs();
