-- Keep the proven legacy recurring renewal, but also emit a deal_payment_line for
-- each renewed payment (linked to the recurring job by service_type) so future
-- recurring payments stay consistent with the jobs model and show under their job
-- in the Jobs & Billing panel. Selection + payment insert are byte-for-byte the
-- same as before; only the line insert is added. (We intentionally keep the engine
-- on this function rather than swapping to the job-driven v2.)
create or replace function public.ensure_recurring_payments()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
begin
  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.end_date is not null
       and dp.end_date <= current_date + interval '7 days'
       and d.archived = false
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_index = dp.service_index
            and dp2.start_date >= dp.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end)
      returning id into v_payment_id;

    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id,
        (select j.id from public.jobs j
          where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
          order by j.created_at limit 1),
        coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);

    created := created + 1;
  end loop;
  return created;
end $function$;

-- ROLLBACK: restore the function body from 20260601000005_deal_payments_vat.sql (no line insert).
