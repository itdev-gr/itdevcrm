-- When a deal moves to accounting 'closed', send every non-archived, non-terminal job to its
-- board's 'closed' lane, completed + unblocked. Never creates a job.
create or replace function public.deals_close_jobs_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.accounting_stage_id is not distinct from old.accounting_stage_id then return new; end if;
  select code into v_code from public.pipeline_stages where id = new.accounting_stage_id and board='accounting_onboarding';
  if v_code <> 'closed' then return new; end if;

  update public.jobs j
     set status = 'completed', completed_at = coalesce(j.completed_at, now()),
         is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         stage_id = coalesce((select cs.id from public.pipeline_stages cs
                               where cs.board = cur.board and cs.code = 'closed' and not cs.archived limit 1),
                             j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id = new.id and not j.archived and cur.id = j.stage_id and not cur.is_terminal;
  return new;
end $$;

drop trigger if exists deals_close_jobs_on_close on public.deals;
create trigger deals_close_jobs_on_close
  after update of accounting_stage_id on public.deals
  for each row execute function public.deals_close_jobs_on_close();

-- Simplify close_deal: just set the deal to Closed; the trigger handles all jobs. p_jobs ignored.
create or replace function public.close_deal(p_deal_id uuid, p_jobs jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare closed_acc uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding','complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  select id into closed_acc from public.pipeline_stages where board='accounting_onboarding' and code='closed' limit 1;
  update public.deals set accounting_stage_id = coalesce(closed_acc, accounting_stage_id) where id = p_deal_id;
  return jsonb_build_object('ok', true, 'deal_id', p_deal_id);
end $$;

-- ROLLBACK: drop trigger deals_close_jobs_on_close + function; restore close_deal from 20260618000006.
