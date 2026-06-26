-- Payment-driven block lifecycle (3/4): the reconciler + cron.
-- For every non-terminal deal with billing + a payment_method (the guard rejects null-PM moves),
-- move it to the stage its DUE date implies, then re-assert job-block flags (self-heal).
-- Nightly run does NOT auto-release On-Hold -> Paid (that's payment-driven); the one-time
-- backfill passes p_allow_release=true to also correct over-held deals.

create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_target text; v_target_id uuid; moved int := 0;
begin
  for r in
    select d.id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
      from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived and ps.code not in ('done','closed')
       and d.payment_method is not null
       and exists (select 1 from public.deal_payments dp where dp.deal_id = d.id and dp.start_date is not null)
  loop
    v_target := public.target_accounting_stage(r.next_due, current_date);
    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full') and v_target is distinct from r.cur_code then
      if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full' and not p_allow_release) then
        select id into v_target_id from public.pipeline_stages where board='accounting_onboarding' and code = v_target;
        update public.deals set accounting_stage_id = v_target_id where id = r.id;  -- fires hold + client-status triggers
        moved := moved + 1;
        continue;
      end if;
    end if;
    -- unchanged stage: re-assert flags
    if r.cur_code in ('on_hold','partial_payment') then
      perform public.block_deal_jobs(r.id);
    else
      update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
        where deal_id = r.id and is_blocked and blocked_reason = 'account_on_hold';
    end if;
  end loop;
  return moved;
end $$;

-- Retire the old end_date overdue cron; the reconciler supersedes it.
do $$ begin
  perform cron.alter_job((select jobid from cron.job where jobname = 'daily_move_overdue_deals_to_on_hold'), active := false);
exception when others then null; end $$;

-- Nightly at 02:20 UTC (after recurring generation + overdue marking).
do $$ begin
  perform cron.unschedule('reconcile_block_lifecycle');
exception when others then null; end $$;
select cron.schedule('reconcile_block_lifecycle', '20 2 * * *', $$ select public.reconcile_block_lifecycle(false); $$);

-- ROLLBACK: unschedule reconcile_block_lifecycle; re-enable daily_move_overdue_deals_to_on_hold;
--   drop function reconcile_block_lifecycle.
