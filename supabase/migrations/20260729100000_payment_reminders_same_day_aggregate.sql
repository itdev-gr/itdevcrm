-- =========================================================================
-- 20260729100000_payment_reminders_same_day_aggregate.sql
--
-- One reminder per (deal, template, due date) — owner decision 2026-07-29
-- (spec docs/superpowers/specs/2026-07-29-same-day-reminder-aggregate-design.md).
-- Previously each deal_payments row emailed on its own (dedupe
-- pay_*:<payment_id>), so two installments due the same day produced two
-- identical-looking emails the same morning.
--
-- Classification (stages, windows, guards) is VERBATIM from 20260702140000;
-- only the emission changes: group same-day rows, SUM amount_gross, one
-- outbox row keyed pay_*:<deal_id>:<YYYYMMDD>. Payments already reminded
-- under a legacy per-payment key are excluded from grouping (no re-emails
-- across the transition); the un-reminded remainder still emails once.
-- Trade-off (accepted): a payment added after its group's email went out is
-- covered by that email — it no longer gets its own reminder.
-- =========================================================================

create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $function$
declare
  r record; dkey text; created int := 0;
begin
  for r in
    with cand as (
      select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
             dp.deal_id, d.code as deal_code, c.name as client_name, c.email as to_email,
             case
               when ps.code = 'awaiting_payment'
                    and dp.start_date > current_date
                    and dp.start_date <= current_date + 7 then 'payment_due_soon'
               when ps.code = 'on_hold'
                    and (current_date - dp.start_date) between 1 and 6 then 'payment_overdue'
               when ps.code = 'on_hold'
                    and (current_date - dp.start_date) >= 7 then 'payment_final_notice'
             end as tkey
        from public.deal_payments dp
        join public.deals d on d.id = dp.deal_id
                           and d.archived = false
                           and d.suppress_payment_reminders = false
        join public.pipeline_stages ps
                          on ps.id = d.accounting_stage_id
                         and ps.board = 'accounting_onboarding'
        join public.clients c on c.id = d.client_id
                             and c.status <> 'done'          -- never email closed clients (2026-07-01 rule)
       where dp.status in ('pending','overdue')
         and dp.paid_at is null                              -- belt-and-suspenders vs status
         and dp.created_at::date < dp.start_date             -- skip back-dated rows (2026-07-01 no-backdated rule)
         and c.email is not null and c.email <> ''
    ),
    classified as (
      select cand.*,
             case tkey when 'payment_due_soon'   then 'pay_soon'
                       when 'payment_overdue'    then 'pay_overdue'
                       when 'payment_final_notice' then 'pay_final' end as prefix
        from cand
       where tkey is not null
    )
    select deal_id, tkey, prefix, due_date, deal_code, client_name, to_email,
           sum(amount_gross) as amount_gross,
           string_agg(distinct service_type, ' + ') as service_type
      from classified cl
     -- Transition guard: a payment already reminded under the legacy
     -- per-payment key never re-aggregates; the rest of its group still
     -- emails once (its own sum).
     where not exists (select 1 from public.email_log l
                        where l.dedupe_key = cl.prefix || ':' || cl.payment_id
                          and l.status = 'sent')
       and not exists (select 1 from public.email_outbox o
                        where o.dedupe_key = cl.prefix || ':' || cl.payment_id
                          and o.status in ('pending','sending','sent'))
     group by deal_id, tkey, prefix, due_date, deal_code, client_name, to_email
  loop
    -- One email per (deal, template, due date): same-day installments go out
    -- as a single summed reminder. Key format has an extra segment vs the
    -- legacy pay_*:<payment_id> scheme, so the two can never collide.
    dkey := r.prefix || ':' || r.deal_id || ':' || to_char(r.due_date, 'YYYYMMDD');

    if exists (select 1 from public.email_log   where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, r.tkey,
            jsonb_build_object('code', r.deal_code, 'client_name', r.client_name,
                               'service_type', r.service_type, 'amount_gross', r.amount_gross,
                               'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $function$;

-- =========================================================================
-- REVERT (verbatim pre-aggregation body, live since 20260702140000; before
-- applying THIS migration to prod, diff pg_get_functiondef output against
-- that body — see the spec's rollback note):
--
--   create or replace function public.enqueue_payment_reminders()
--   returns int
--   language plpgsql security definer set search_path = public as $function$
--   declare
--     r record; tkey text; dkey text; prefix text; created int := 0; v_days_past int;
--   begin
--     for r in
--       select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
--              dp.deal_id, d.code as deal_code, c.name as client_name, c.email as to_email,
--              ps.code as stage_code
--         from public.deal_payments dp
--         join public.deals d on d.id = dp.deal_id
--                            and d.archived = false
--                            and d.suppress_payment_reminders = false
--         join public.pipeline_stages ps
--                           on ps.id = d.accounting_stage_id
--                          and ps.board = 'accounting_onboarding'
--         join public.clients c on c.id = d.client_id
--                              and c.status <> 'done'
--        where dp.status in ('pending','overdue')
--          and dp.paid_at is null
--          and dp.created_at::date < dp.start_date
--          and c.email is not null and c.email <> ''
--     loop
--       v_days_past := current_date - r.due_date;
--
--       if r.stage_code = 'awaiting_payment'
--          and r.due_date > current_date
--          and r.due_date <= current_date + 7 then
--         tkey := 'payment_due_soon';     prefix := 'pay_soon';
--       elsif r.stage_code = 'on_hold' and v_days_past between 1 and 6 then
--         tkey := 'payment_overdue';      prefix := 'pay_overdue';
--       elsif r.stage_code = 'on_hold' and v_days_past >= 7 then
--         tkey := 'payment_final_notice'; prefix := 'pay_final';
--       else
--         continue;
--       end if;
--
--       dkey := prefix || ':' || r.payment_id;
--
--       if exists (select 1 from public.email_log   where dedupe_key = dkey and status = 'sent') then
--         continue;
--       end if;
--       if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
--         continue;
--       end if;
--
--       insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
--       values ('accounting', r.to_email, tkey,
--               jsonb_build_object('code', r.deal_code, 'client_name', r.client_name,
--                                  'service_type', r.service_type, 'amount_gross', r.amount_gross,
--                                  'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
--               dkey);
--       created := created + 1;
--     end loop;
--     return created;
--   end $function$;
-- =========================================================================
