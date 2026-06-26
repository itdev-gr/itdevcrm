-- Per-deal "pause payment reminders" toggle.
-- When deals.suppress_payment_reminders = true, enqueue_payment_reminders() skips
-- that deal entirely (all 3 reminders: due_soon -7d / overdue +1d / final_notice +7d).
-- Editable from the deal Payment tab by accounting + admins (UI-gated, same as the
-- other billing fields). Default false => no behaviour change for existing deals.

alter table public.deals
  add column if not exists suppress_payment_reminders boolean not null default false;

comment on column public.deals.suppress_payment_reminders is
  'When true, enqueue_payment_reminders() skips this deal (no payment-reminder emails to the client).';

-- Recreate the reminder enqueuer with one added predicate on the deal join.
-- (Identical to 20260616000005 except for the `and d.suppress_payment_reminders = false` line.)
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
      join public.deals d on d.id = dp.deal_id
                         and d.archived = false
                         and d.suppress_payment_reminders = false   -- NEW: skip paused deals
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
            jsonb_build_object('client_name', r.client_name, 'service_type', r.service_type,
                               'amount_gross', r.amount_gross, 'due_date', to_char(r.due_date, 'DD/MM/YYYY'),
                               'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK:
--   alter table public.deals drop column if exists suppress_payment_reminders;
--   -- then `create or replace function public.enqueue_payment_reminders()` restoring the
--   -- version in 20260616000005 (remove the `and d.suppress_payment_reminders = false` line).
