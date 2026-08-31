-- =========================================================================
-- 20260831230000_reminders_require_first_payment.sql
--
-- Business rule (owner, 2026-08-31): NO automated payment reminder goes to a
-- client whose deal has never had a single PAID payment — accounting handles
-- first collections personally. Closes the gap where dragging a fresh deal to
-- Awaiting Payment started due-soon emails before the client ever paid.
--
-- Guard is «≥1 paid deal_payments row», deliberately NOT
-- deals.first_paid_in_full_at: deals 004556 / 005690 / 006846 sit in on_hold
-- with 2-3 paid rows but never reached paid_in_full — the stage stamp would
-- silence those legit debtors. Verified in prod at authoring time: every
-- reminder-eligible deal (38 awaiting_payment + 29 on_hold) has ≥1 paid row,
-- so this guard changes nothing for the current population.
--
-- Redefines enqueue_payment_reminders(): byte-identical to
-- 20260729110000_reminder_breakdown.sql (verified latest; live md5 matched
-- repo per the 2026-08-26 audit F8) except the one `exists (… status='paid')`
-- guard in the candidate WHERE. md5 pre/post recorded in deploy output.
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
         -- 2026-08-31 first-payment rule: never auto-remind a deal that has
         -- no paid payment yet — first collections are handled personally.
         and exists (select 1 from public.deal_payments dpp
                      where dpp.deal_id = d.id and dpp.status = 'paid')
    ),
    classified as (
      select cand.*,
             case tkey when 'payment_due_soon'   then 'pay_soon'
                       when 'payment_overdue'    then 'pay_overdue'
                       when 'payment_final_notice' then 'pay_final' end as prefix
        from cand
       where tkey is not null
    ),
    per_service as (
      select deal_id, tkey, prefix, due_date, deal_code, client_name, to_email,
             service_type, sum(amount_gross) as svc_amount
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
       group by deal_id, tkey, prefix, due_date, deal_code, client_name, to_email, service_type
    )
    select deal_id, tkey, prefix, due_date, deal_code, client_name, to_email,
           sum(svc_amount) as amount_gross,
           string_agg(service_type, ' + ' order by service_type) as service_type,
           -- Per-service ανάλυση ONLY when the aggregate spans 2+ services;
           -- '' otherwise so single-service emails render exactly as before.
           -- Leading \n lives here (not in the template) for the same reason.
           case when count(*) > 1 then
             E'\n(' || string_agg(
               case service_type
                 when 'web_seo'      then 'Web SEO'
                 when 'local_seo'    then 'Τοπικό SEO'
                 when 'web_dev'      then 'Ανάπτυξη Ιστού'
                 when 'social_media' then 'Social Media'
                 when 'ai_seo'       then 'AI SEO'
                 when 'hosting'      then 'Φιλοξενία'
                 when 'ads'          then 'Διαφημίσεις'
                 when 'maintenance'  then 'Συντήρηση'
                 when 'other'        then 'Λοιπές Υπηρεσίες'
                 else service_type end
               || ': ' || trim(trailing '.' from trim(trailing '0' from svc_amount::text)) || '€',
               ' • ' order by service_type) || ')'
           else '' end as breakdown
      from per_service
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
                               'breakdown', r.breakdown,
                               'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $function$;

-- ROLLBACK: re-run the CREATE OR REPLACE in
-- 20260729110000_reminder_breakdown.sql (drops only the first-payment guard).
