-- Blocking skips Done jobs (and never moves a job — stage_id untouched). Reconciler's
-- completed-work cleanup also clears blocks on Done-stage jobs.
create or replace function public.block_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jobs j
     set is_blocked = true, blocked_reason = 'account_on_hold', blocked_at = now()
   where j.deal_id = p_deal_id and not j.archived and not j.is_blocked
     and j.service_type not in ('web_dev','hosting')
     and (j.stage_id is null
          or not exists (select 1 from public.pipeline_stages s
                          where s.id = j.stage_id and (s.is_terminal or s.code = 'done')));
end $$;

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
        update public.deals set accounting_stage_id = v_target_id where id = r.id;
        moved := moved + 1; continue;
      end if;
    end if;
    if r.cur_code in ('on_hold','partial_payment') then
      perform public.block_deal_jobs(r.id);
    else
      update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
        where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
    end if;
  end loop;
  update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
    from public.pipeline_stages s
   where s.id = j.stage_id and (s.is_terminal or s.code='done')
     and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;
  return moved;
end $$;

-- ROLLBACK: restore block_deal_jobs + reconcile_block_lifecycle from 20260626000015 (no done exclusion).
