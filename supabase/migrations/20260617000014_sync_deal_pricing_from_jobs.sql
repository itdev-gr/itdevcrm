-- Once the deal's Services Planned editor is replaced by the Jobs & Billing panel,
-- the deal's stored pricing totals (deals.one_time_value / recurring_monthly_value,
-- read by the accounting kanban cards + lock validation) must follow the JOBS instead
-- of services_planned. This trigger recomputes them from active, non-archived jobs
-- whenever a job's billing changes — and only writes when a total actually changes,
-- so job stage-moves (which don't affect price) don't touch the deal or bump its
-- updated_at (which would reorder the accounting board).
create or replace function public.sync_deal_pricing_from_jobs()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_deal uuid; v_one numeric; v_month numeric;
begin
  v_deal := coalesce(new.deal_id, old.deal_id);
  if v_deal is null then return coalesce(new, old); end if;

  select coalesce(sum(amount_net) filter (where billing_type = 'one_time'), 0)
           + coalesce(sum(setup_fee), 0),
         coalesce(sum(amount_net) filter (where billing_type = 'recurring_monthly'), 0)
    into v_one, v_month
    from public.jobs
   where deal_id = v_deal and not archived and billing_active;

  update public.deals set one_time_value = v_one, recurring_monthly_value = v_month
   where id = v_deal
     and (one_time_value is distinct from v_one or recurring_monthly_value is distinct from v_month);

  return coalesce(new, old);
end $$;

drop trigger if exists jobs_sync_deal_pricing on public.jobs;
create trigger jobs_sync_deal_pricing
  after insert or update or delete on public.jobs
  for each row execute function public.sync_deal_pricing_from_jobs();

-- ROLLBACK:
-- drop trigger if exists jobs_sync_deal_pricing on public.jobs;
-- drop function if exists public.sync_deal_pricing_from_jobs();
