-- Enqueue accounting reminder emails for pending deal_payments at the
-- 3-days-before / due-today / 1-day-overdue marks. Idempotent: skips any
-- (dedupe_key) already sent (email_log) or already queued (email_outbox).
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
     where dp.status = 'pending'
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 3, current_date, current_date - 1)
  loop
    if r.due_date = current_date + 3 then
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

-- Daily at 06:00 UTC (~09:00 Europe/Athens in summer).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily_payment_reminders') then
    perform cron.unschedule('daily_payment_reminders');
  end if;
  perform cron.schedule('daily_payment_reminders', '0 6 * * *',
    $cron$ select public.enqueue_payment_reminders(); $cron$);
end $$;

-- ROLLBACK:
-- do $$ begin
--   if exists (select 1 from cron.job where jobname='daily_payment_reminders') then
--     perform cron.unschedule('daily_payment_reminders'); end if;
-- end $$;
-- drop function if exists public.enqueue_payment_reminders();
