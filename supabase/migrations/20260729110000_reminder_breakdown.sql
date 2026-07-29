-- =========================================================================
-- 20260729110000_reminder_breakdown.sql
--
-- Per-service breakdown line in AGGREGATED payment reminders (owner request
-- 2026-07-29, follow-up to 20260729100000 same-day aggregation): when one
-- reminder covers 2+ services, the email shows
--   Ποσό πληρωμής: 558€
--   (Ανάπτυξη Ιστού: 186€ • Φιλοξενία: 248€ • Web SEO: 124€)
-- Single-service reminders keep rendering byte-identical to today: the fn
-- passes breakdown='' and the template's {{breakdown}} interpolates to ''.
--
-- Two pieces, one migration:
--   1. enqueue_payment_reminders(): pre-aggregate per service, emit
--      data.breakdown (leading \n included, so '' leaves no blank line).
--      Labels mirror SERVICE_LABELS_EL in send-email/templates.ts.
--   2. email_templates: append {{breakdown}} after the amount line in the 3
--      reminder bodies (guarded, idempotent; greeting/sign-off untouched).
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

-- Append {{breakdown}} right after the amount line in the 3 reminder bodies.
-- Guarded so a re-run cannot double-append; greeting and sign-off untouched
-- (admin-edited prod content — only this one line changes).
update public.email_templates
   set body = replace(body,
       'Ποσό πληρωμής: {{amount_gross}}€',
       'Ποσό πληρωμής: {{amount_gross}}€{{breakdown}}')
 where key in ('payment_due_soon','payment_overdue','payment_final_notice')
   and body like '%Ποσό πληρωμής: {{amount_gross}}€%'
   and body not like '%{{breakdown}}%';

-- =========================================================================
-- REVERT:
--   1) Remove the placeholder from the templates:
--     update public.email_templates
--        set body = replace(body, '{{amount_gross}}€{{breakdown}}', '{{amount_gross}}€')
--      where key in ('payment_due_soon','payment_overdue','payment_final_notice');
--   2) Restore the pre-breakdown function body: run the CREATE OR REPLACE in
--      20260729100000_payment_reminders_same_day_aggregate.sql (its own
--      REVERT block restores the pre-aggregation body if needed further).
-- NB: {{breakdown}} with no data key interpolates to '' — the placeholder is
-- harmless even if only one of the two pieces is reverted.
-- =========================================================================
