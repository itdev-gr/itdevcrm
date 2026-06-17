-- Job-driven payment generation. Creates payment headers + lines from a deal's jobs.
-- Idempotent: only processes jobs that have no payment line yet.
-- Grouping: jobs sharing billing_group_id (and cadence) bill TOGETHER on one header
-- (one line each); ungrouped jobs each get their own header (SEPARATE).
-- Header amount_net/vat_rate are kept denormalized = sum / common rate of the header's
-- main lines, so legacy readers (kanban card, ledger, reminders) that read deal_payments
-- directly stay correct; the deal_payments_with_totals view also sums the lines.
-- Setup fees get their OWN one-time header so they never recur.
create or replace function public.generate_payments_for_deal(target_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_start date;
  v_end date;
  grp record;
  j record;
  v_payment_id uuid;
begin
  select coalesce(actual_close_date, current_date) into v_start from public.deals where id = target_deal_id;
  if v_start is null then v_start := current_date; end if;

  -- 1) Main charges, grouped (together) or solo (separate), per billing_type.
  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key, jb.billing_type
      from public.jobs jb
     where jb.deal_id = target_deal_id and not jb.archived and jb.billing_active
       and jb.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and not exists (select 1 from public.deal_payment_lines l where l.job_id = jb.id)
     group by coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text), jb.billing_type
  loop
    v_end := case grp.billing_type
               when 'recurring_monthly' then (v_start + interval '1 month')::date
               when 'recurring_yearly'  then (v_start + interval '1 year')::date
               else v_start end;

    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, null, grp.billing_type, v_start, v_end, 'pending', 0, 24)
      returning id into v_payment_id;

    for j in
      select * from public.jobs jj
       where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
         and jj.billing_type = grp.billing_type
         and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key
         and not exists (select 1 from public.deal_payment_lines l where l.job_id = jj.id)
    loop
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id, coalesce(nullif(j.title, ''), j.service_type),
                coalesce(j.amount_net, 0), coalesce(j.vat_rate, 24));
    end loop;

    -- denormalize header from its main lines (uniform VAT per client)
    update public.deal_payments p set
      amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
      vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24)
     where p.id = v_payment_id;
  end loop;

  -- 2) Setup fees: own one-time header per job, so they never recur.
  for j in
    select * from public.jobs jj
     where jj.deal_id = target_deal_id and not jj.archived and jj.billing_active
       and coalesce(jj.setup_fee, 0) > 0
       and not exists (select 1 from public.deal_payment_lines l
                        where l.job_id = jj.id and l.label = 'Setup fee')
  loop
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (target_deal_id, j.service_type, 'one_time', v_start, v_start, 'pending', j.setup_fee, coalesce(j.vat_rate, 24))
      returning id into v_payment_id;
    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id, j.id, 'Setup fee', j.setup_fee, coalesce(j.vat_rate, 24));
  end loop;
end $$;

grant execute on function public.generate_payments_for_deal(uuid) to authenticated;

-- ROLLBACK: drop function if exists public.generate_payments_for_deal(uuid);
