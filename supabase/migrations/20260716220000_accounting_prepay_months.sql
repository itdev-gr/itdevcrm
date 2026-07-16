-- =============================================================================
-- Prepay N months (owner decision 2026-07-16): one RPC creates N chained
-- recurring_monthly periods per active monthly chain of the deal, born PAID
-- (paid_at = now()), mirroring ensure_recurring_payments_v2's grouping
-- (billing_group_id or solo:<job_id>) and line-seeding exactly. p_dry_run
-- returns the same per-group preview without inserting — the UI dialog shows
-- server-computed numbers. Knock-ons are all existing verified machinery:
-- recompute_job_period_dates, reconcile_deal_stage, on-hold release, nightly
-- spawner successor guard, duplicate-period trigger (suppressed inserts are
-- counted as skipped_duplicates, the chain still advances).
--
-- ROLLBACK (manual): drop function public.accounting_prepay_months(uuid, int, boolean);
-- =============================================================================

create or replace function public.accounting_prepay_months(
  p_deal_id uuid,
  p_months int,
  p_dry_run boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  grp record;
  v_months int;
  v_payment_id uuid;
  v_start date;
  v_end date;
  v_created int := 0;
  v_skipped int := 0;
  v_grp_created int;
  v_services text[];
  v_monthly_net numeric;
  v_groups jsonb := '[]'::jsonb;
  i int;
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  v_months := least(greatest(coalesce(p_months, 0), 1), 12);

  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key,
           max(p.end_date) as cur_end
      from public.jobs jb
      join public.deal_payment_lines l on l.job_id = jb.id
      join public.deal_payments p on p.id = l.payment_id and p.billing_type = jb.billing_type
     where jb.deal_id = p_deal_id and jb.billing_active and not jb.archived
       and jb.billing_type = 'recurring_monthly'
     group by 1
  loop
    select array_agg(distinct jj.service_type),
           coalesce(sum(coalesce(jj.amount_net, 0)), 0)
      into v_services, v_monthly_net
      from public.jobs jj
     where jj.deal_id = p_deal_id and jj.billing_active and not jj.archived
       and jj.billing_type = 'recurring_monthly'
       and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key;

    if grp.cur_end is null then
      v_groups := v_groups || jsonb_build_object(
        'group_key', grp.group_key, 'services', to_jsonb(v_services),
        'monthly_net', v_monthly_net, 'error', 'no_base_period', 'created', 0);
      continue;
    end if;

    v_start := grp.cur_end;
    v_grp_created := 0;

    for i in 1..v_months loop
      v_end := (v_start + interval '1 month')::date;
      if not p_dry_run then
        v_payment_id := null;
        insert into public.deal_payments
          (deal_id, service_type, billing_type, start_date, end_date, status, paid_at, amount_net, vat_rate)
        values
          (p_deal_id, null, 'recurring_monthly', v_start, v_end, 'paid', now(), 0, 24)
        returning id into v_payment_id;

        if v_payment_id is null then
          -- duplicate-period trigger suppressed the row; chain still advances
          v_skipped := v_skipped + 1;
        else
          insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
            select v_payment_id, jj.id,
                   coalesce(nullif(jj.title, ''), jj.service_type),
                   coalesce(jj.amount_net, 0), coalesce(jj.vat_rate, 24)
              from public.jobs jj
             where jj.deal_id = p_deal_id and jj.billing_active and not jj.archived
               and jj.billing_type = 'recurring_monthly'
               and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key;
          update public.deal_payments p set
            amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
            vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24)
           where p.id = v_payment_id;
          v_created := v_created + 1;
          v_grp_created := v_grp_created + 1;
        end if;
      end if;
      v_start := v_end;
    end loop;

    v_groups := v_groups || jsonb_build_object(
      'group_key', grp.group_key, 'services', to_jsonb(v_services),
      'monthly_net', v_monthly_net, 'from', grp.cur_end, 'to', v_start,
      'created', case when p_dry_run then v_months else v_grp_created end);
  end loop;

  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('ok', false, 'errors', array['no_monthly_chain']);
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'months', v_months,
    'periods_created', v_created, 'skipped_duplicates', v_skipped,
    'groups', v_groups);
end $$;

revoke execute on function public.accounting_prepay_months(uuid, int, boolean) from public, anon;
grant execute on function public.accounting_prepay_months(uuid, int, boolean) to authenticated;

-- Post-asserts.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'accounting_prepay_months';
  if n <> 1 then raise exception 'accounting_prepay_months missing (found %)', n; end if;
  if exists (
    select 1 from information_schema.routine_privileges rp
     where rp.routine_schema = 'public' and rp.routine_name = 'accounting_prepay_months'
       and rp.grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'accounting_prepay_months leaked to anon/PUBLIC';
  end if;
end $$;
