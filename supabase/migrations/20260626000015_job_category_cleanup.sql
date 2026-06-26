-- Put every job in a correct category after the block-lifecycle rollout:
--  (1) Unblock jobs that are blocked but already in a terminal (done/closed) stage —
--      completed work must not sit in the Blocked column. Also add this as a nightly
--      self-heal in reconcile_block_lifecycle.
--  (2) Give stage-less local_seo jobs the board's 'New project' lane so they show on the
--      board. Onboarding-email trigger suppressed for this data fix (no surprise client mail).

-- (1) one-time: clear blocks on completed work
update public.jobs j
   set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
  from public.pipeline_stages s
 where s.id = j.stage_id and s.is_terminal
   and j.is_blocked and j.blocked_reason = 'account_on_hold' and not j.archived;

-- (2) stage-less local_seo -> New project (suppress the SEO onboarding email side-effect)
alter table public.jobs disable trigger jobs_seo_onboarding_email;
update public.jobs j
   set stage_id = (select id from public.pipeline_stages where board='local_seo' and code='new_project' and not archived limit 1)
 where j.service_type = 'local_seo' and j.stage_id is null and not j.archived;
alter table public.jobs enable trigger jobs_seo_onboarding_email;

-- nightly self-heal: reconciler also clears blocks that landed on terminal work
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
        moved := moved + 1;
        continue;
      end if;
    end if;
    if r.cur_code in ('on_hold','partial_payment') then
      perform public.block_deal_jobs(r.id);
    else
      update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
        where deal_id = r.id and is_blocked and blocked_reason = 'account_on_hold';
    end if;
  end loop;
  -- clear blocks on completed (terminal) work, deal-agnostic
  update public.jobs j set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
    from public.pipeline_stages s
   where s.id = j.stage_id and s.is_terminal
     and j.is_blocked and j.blocked_reason = 'account_on_hold' and not j.archived;
  return moved;
end $$;

-- ROLLBACK: stage/block changes are forward-only data fixes (re-derive from the board if needed);
--   reconcile_block_lifecycle revert = restore the 20260626000012 body (no terminal-cleanup tail).
