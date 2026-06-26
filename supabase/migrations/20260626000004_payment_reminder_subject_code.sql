-- Payment-reminder subjects are prefixed `{{code}} - ` (client-code convention), but
-- enqueue_payment_reminders() never passed `code` in its data payload, so subjects
-- rendered with a leading " - " (empty code). Now that the cron is re-enabled
-- (20260626000001), pass the deal code so subjects render e.g. "001089 - Υπενθύμιση…".
-- (Same body as 20260626000000 + the suppress predicate; only adds d.code -> data.code.)

create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  tkey text;
  dkey text;
  prefix text;
  created int := 0;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, d.code as deal_code, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
                         and d.archived = false
                         and d.suppress_payment_reminders = false
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending', 'overdue')
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 7, current_date - 1, current_date - 7)
  loop
    if r.due_date = current_date + 7 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date - 1 then
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
    else
      tkey := 'payment_final_notice'; prefix := 'pay_final';
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('code', r.deal_code, 'client_name', r.client_name,
                               'service_type', r.service_type, 'amount_gross', r.amount_gross,
                               'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK: re-apply 20260626000000 (data payload without 'code').
