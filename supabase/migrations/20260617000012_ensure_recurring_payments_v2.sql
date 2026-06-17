-- Job-driven recurring renewal. Renews per billing group of ACTIVE recurring jobs:
-- when a group's latest period ends within 7 days and has no successor, create the
-- next period (header + one line per active job in the group). billing_active=false
-- jobs are skipped, so "ending" a job stops renewal — no manual recreation.
--
-- NOTE: this is NOT yet wired to the daily cron. The cron still calls the legacy
-- ensure_recurring_payments() until the cutover is approved. Call this manually to
-- demo, or repoint the cron at approval time.
create or replace function public.ensure_recurring_payments_v2()
returns integer language plpgsql security definer set search_path = public as $$
declare grp record; j record; v_payment_id uuid; v_start date; v_end date; v_count int := 0;
begin
  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key,
           jb.deal_id, jb.billing_type, max(p.end_date) as cur_end
      from public.jobs jb
      join public.deal_payment_lines l on l.job_id = jb.id
      join public.deal_payments p on p.id = l.payment_id and p.billing_type = jb.billing_type
      join public.deals d on d.id = jb.deal_id and not d.archived
     where jb.billing_active and not jb.archived
       and jb.billing_type in ('recurring_monthly','recurring_yearly')
     group by coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text), jb.deal_id, jb.billing_type
    having max(p.end_date) <= current_date + interval '7 days'
  loop
    -- successor guard: skip if a period already starts at/after cur_end
    if exists (
      select 1 from public.deal_payments p2
        join public.deal_payment_lines l2 on l2.payment_id = p2.id
        join public.jobs j2 on j2.id = l2.job_id
       where j2.deal_id = grp.deal_id and j2.billing_type = grp.billing_type
         and coalesce(j2.billing_group_id::text, 'solo:' || j2.id::text) = grp.group_key
         and p2.start_date >= grp.cur_end
    ) then continue; end if;

    v_start := grp.cur_end;
    v_end := case grp.billing_type
               when 'recurring_monthly' then (v_start + interval '1 month')::date
               when 'recurring_yearly'  then (v_start + interval '1 year')::date end;
    insert into public.deal_payments
      (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
      values (grp.deal_id, null, grp.billing_type, v_start, v_end, 'pending', 0, 24)
      returning id into v_payment_id;
    for j in select * from public.jobs jj
       where jj.deal_id = grp.deal_id and jj.billing_active and not jj.archived
         and jj.billing_type = grp.billing_type
         and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key
    loop
      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id, j.id, coalesce(nullif(j.title, ''), j.service_type),
                coalesce(j.amount_net, 0), coalesce(j.vat_rate, 24));
    end loop;
    update public.deal_payments p set
      amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
      vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24)
     where p.id = v_payment_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
grant execute on function public.ensure_recurring_payments_v2() to authenticated;

-- ROLLBACK: drop function if exists public.ensure_recurring_payments_v2();
