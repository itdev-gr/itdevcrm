-- Send the pre-payment reminder (payment_due_soon) 7 days before the due date
-- instead of 3. The "due today" (current_date) and "overdue" (current_date - 1)
-- reminders are unchanged.
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
           dp.deal_id, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id and d.archived = false
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending', 'overdue')
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 7, current_date, current_date - 1)
  loop
    if r.due_date = current_date + 7 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date then
      tkey := 'payment_due_today'; prefix := 'pay_today';
    else
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
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
            jsonb_build_object('client_name', r.client_name, 'service_type', r.service_type,
                               'amount_gross', r.amount_gross, 'due_date', to_char(r.due_date, 'DD/MM/YYYY'),
                               'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- Keep the template description accurate.
update public.email_templates
   set description = 'Payment reminder — 7 days before the due date'
 where key = 'payment_due_soon';

-- ROLLBACK: restore the 3-day window (change both `current_date + 7` back to
-- `current_date + 3` in enqueue_payment_reminders), and set the description back
-- to 'Payment reminder — 3 days before the due date'.
