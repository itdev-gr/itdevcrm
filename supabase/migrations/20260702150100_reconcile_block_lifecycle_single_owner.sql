-- Nightly sweep becomes a thin loop over the single rule (reconcile_deal_stage),
-- dropping the 24h grace + the old per-deal target logic. Same signature; callers
-- (the cron + run_daily_payment_reminders) unchanged. p_allow_release is now ignored.
create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record; moved int := 0;
begin
  for r in
    select d.id
      from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived
       and ps.code in ('awaiting_payment','on_hold','paid_in_full')
       and d.payment_method is not null
  loop
    if public.reconcile_deal_stage(r.id) then moved := moved + 1; end if;
  end loop;

  -- safety net: terminal/done jobs never stay account_on_hold-blocked
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
    from public.pipeline_stages s
   where s.id = j.stage_id and (s.is_terminal or s.code='done')
     and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;

  return moved;
end $$;

-- ============================================================================
-- REVERT: restore the prior (24h-grace) body, captured live 2026-07-02 via
--   select pg_get_functiondef('public.reconcile_block_lifecycle(boolean)'::regprocedure);
-- ----------------------------------------------------------------------------
-- create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
--  returns integer language plpgsql security definer set search_path to 'public'
-- as $function$
-- declare r record; v_target text; v_target_id uuid; moved int := 0;
--         v_eff_next_due date; v_eff_target text;
-- begin
--   for r in
--     select d.id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
--       from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
--      where not d.archived and ps.code not in ('done','closed')
--        and d.payment_method is not null
--        and exists (select 1 from public.deal_payments dp
--                     where dp.deal_id = d.id and dp.start_date is not null)
--   loop
--     v_target := public.target_accounting_stage(r.next_due, current_date);
--     select min(dp.start_date) into v_eff_next_due
--       from public.deal_payments dp
--      where dp.deal_id = r.id and dp.status <> 'paid' and dp.status <> 'cancelled'
--        and dp.created_at <= now() - interval '24 hours';
--     v_eff_target := public.target_accounting_stage(v_eff_next_due, current_date);
--     if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
--        and v_target = 'on_hold' and v_eff_target = 'paid_in_full' then
--       if r.cur_code <> 'paid_in_full' then
--         select id into v_target_id from public.pipeline_stages
--           where board='accounting_onboarding' and code = 'paid_in_full';
--         update public.deals set accounting_stage_id = v_target_id where id = r.id;
--         moved := moved + 1;
--       end if;
--       update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
--         where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
--       continue;
--     end if;
--     if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
--        and v_target is distinct from r.cur_code then
--       if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full' and not p_allow_release) then
--         select id into v_target_id from public.pipeline_stages
--           where board='accounting_onboarding' and code = v_target;
--         update public.deals set accounting_stage_id = v_target_id where id = r.id;
--         moved := moved + 1; continue;
--       end if;
--     end if;
--     if r.cur_code in ('on_hold','partial_payment') then
--       perform public.block_deal_jobs(r.id);
--     else
--       update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
--         where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
--     end if;
--   end loop;
--   update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
--     from public.pipeline_stages s
--    where s.id = j.stage_id and (s.is_terminal or s.code='done')
--      and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;
--   return moved;
-- end $function$;
-- ============================================================================
