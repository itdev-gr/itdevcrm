-- =============================================================================
-- 20260904230000_no_reminders_for_archived_jobs.sql
-- Final-review I7 (2026-09-04-end-archive-jobs): once a service is archived
-- (End -> end_and_archive_job), the daily `enqueue_payment_reminders()` cron
-- never looked at `jobs` at all, so a client kept getting payment_due_soon /
-- payment_overdue / payment_final_notice emails for a service we had just
-- told them is finished.
--
-- OWNER DECISION (verbatim reasoning): reminders should stop, because
-- accounting is expected to have settled or cancelled every payment with
-- that client before archiving, and the End dialog already warns about any
-- unpaid balance (end_and_archive_job's job_unpaid_total warning). This is a
-- new exclusion added to the existing candidate CTE — nothing else about
-- who gets reminded, wording, schedule or dedupe changes.
--
-- Granularity: deal_payments links to jobs by (deal_id, service_type), and a
-- deal can carry TWO jobs of the same service_type (e.g. two web_dev sites,
-- see 20260720120000_add_web_dev_job.sql). "Some job for the pair is
-- archived" would wrongly silence reminders for a still-live sibling
-- service, so the guard is "every non-cancelled job for the pair is
-- archived", not "some job archived". Cancelled jobs are ignored on both
-- sides of that count (they were never billable and never archived by End,
-- so they must not keep a genuinely-finished pair "not fully archived", and
-- they must not count toward "no jobs for the pair either" below).
--
-- Written as: exclude the row only when (a) at least one non-cancelled job
-- exists for the (deal_id, service_type) pair -- so a deal with no jobs rows
-- at all for that service (a pre-existing, monitored data anomaly per
-- money_integrity_checks' won_deal_no_services alert) is left untouched,
-- reminders behave exactly as before -- AND (b) none of those non-cancelled
-- jobs is still live (not archived). (a) alone is "not exists a live pair",
-- (a) requires the pair to be non-empty to matter.
--
-- Base: 20260902110000_reminders_late_rows_grace.sql (byte-identical body
-- except the one new guard below, added to the `cand` CTE's WHERE clause).
-- =============================================================================

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
             -- 2026-09-02 late-rows grace: rows entered on/after their due
             -- date become ELIGIBLE 3 days after entry; until then they only
             -- contribute to the group total, never trigger it.
             (dp.created_at::date < dp.start_date
              or current_date >= dp.created_at::date + 3) as eligible,
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
         and c.email is not null and c.email <> ''
         -- 2026-08-31 first-payment rule: never auto-remind a deal that has
         -- no paid payment yet — first collections are handled personally.
         and exists (select 1 from public.deal_payments dpp
                      where dpp.deal_id = d.id and dpp.status = 'paid')
         -- 2026-09-04 (final-review I7): stop reminding once the service this
         -- payment belongs to is archived. Only suppresses when EVERY
         -- non-cancelled job for the (deal_id, service_type) pair is
         -- archived; a still-live sibling job of the same service_type keeps
         -- the reminder alive, and a pair with no job rows at all is left
         -- untouched (existing behaviour, not a new suppression).
         and not (
           exists (select 1 from public.jobs j
                    where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                      and j.status <> 'cancelled')
           and not exists (select 1 from public.jobs j
                             where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                               and j.status <> 'cancelled' and not j.archived)
         )
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
             service_type, sum(amount_gross) as svc_amount,
             bool_or(eligible) as eligible
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
    -- 2026-09-02: the email fires only when at least one row of the group is
    -- eligible; totals above already include the non-eligible siblings.
    having bool_or(eligible)
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
-- 20260902110000_reminders_late_rows_grace.sql (drops the archived-service
-- guard, restores the byte-identical prior body).
