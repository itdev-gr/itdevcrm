-- =============================================================================
-- Integrity alert 24: service_card_not_billing — a live card whose service
-- nobody bills.
--
-- WHY (deal 000403, read live 2026-08-04): the SEO service on this deal was
-- changed by hand from local_seo to web_seo. Both SEO jobs ended up with
-- billing_active = false — the old job because the switch turned it off, the
-- new job because nothing turned it on. ensure_recurring_payments() only
-- extends a billing period when a NON-archived, billing_active job of the
-- same service_type + billing_type exists on the deal, so once the last such
-- job lost billing_active the schedule stopped silently. The card stayed on
-- the board, work kept shipping, and billing was dark for two months before
-- anyone noticed. The existing billing_gap check (11) cannot catch this: it
-- only fires when a billing_active recurring job exists and its payment
-- periods lapse — here there was no billing_active job left to have a gap.
-- Task 1 (20260805090000) makes 000403-WEBSEO the billing owner going
-- forward; this check is the backstop so the next silent handoff surfaces in
-- the accounting Alerts panel instead of two months later.
--
-- TUNING — measured on prod 2026-08-04 by the controller (no DB access from
-- this migration's author; these numbers are transcribed, not re-derived):
--
--   variant                                                            rows
--   naive (live lane, recurring, not billing_active,                   131
--     no billing_active sibling of the same service)
--   + exclude parent_job_id is not null                                 35
--   + exclude deals with a billing_active ai_seo parent                 33
--   + require amount_net > 0                                            31
--   + exclude deals whose accounting stage is closed/done                11
--   + require j.status = 'active'  -> shipped variant                   10
--
-- The 96 rows the first exclusion removes are AI-SEO trio children: their
-- billing sits on the ai_seo parent by design, so they are not defects. The
-- closed/done exclusion matches how checks 1, 12 and 14 already scope
-- themselves. Severity is red: at 10 rows this is a short, actionable list,
-- and every row is a service being delivered with nobody billing it.
--
-- The 10 deals on prod 2026-08-04 (shipped variant): 000039, 000082, 000122,
-- 000150, 000289, 000306, 000328, 000362, 005497, 005557.
--
-- Base body: supabase/migrations/20260804091000_renewal_integrity_alerts.sql,
-- checks 1-23, live md5 d5a886e95dfeb92673258d035cd6a818 as applied to prod
-- 2026-08-04. Copied verbatim below; only check 24 and its union all are new.
--
-- EXPECTED after this migration lands (controller verifies): check 24 returns
-- exactly the 10 deals listed above, and zero rows for deal 000403 (Task 1
-- already made 000403-WEBSEO the billing_active job for that deal).
--
-- APPLIED to prod 2026-08-06 (delayed: three earlier attempts were refused by a
-- permission gate, not by the database). Post-change md5(pg_get_functiondef) =
--   8eb7f3866b45c21e6b9bd1f777e21a6a
-- First live run returns 9 rows, not the 10 measured on 2026-08-04 — one of the
-- listed deals was resolved in the meantime. 000403 returns zero rows as
-- expected.
--
-- ROLLBACK: re-apply the accounting_integrity_alerts body from
--   20260804091000_renewal_integrity_alerts.sql (md5 d5a886e95dfeb92673258d035cd6a818).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accounting_integrity_alerts()
 RETURNS TABLE(check_key text, severity text, category text, subject_type text, subject_id uuid, subject_code text, title text, detail text, deal_id uuid, job_id uuid, signature text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return; -- no rows for anyone else
  end if;
  return query
  with alerts (check_key, severity, category, subject_type,
               subject_id, subject_code, title, detail,
               deal_id, job_id, signature) as (
    -- 1 deal_zero_value
    select 'deal_zero_value'::text, 'amber'::text, 'money'::text, 'deal'::text,
           d.id, d.code, 'Deal has €0 total'::text,
           'One-time €0 and monthly €0'::text, d.id, null::uuid, ''::text
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0
    union all
    -- 2 recurring_job_zero
    select 'recurring_job_zero','red','money','job', j.id, j.code, 'Recurring job bills €0',
           'Active recurring job with amount_net = 0', j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active and j.parent_job_id is null
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)=0
    union all
    -- 3 vat_missing (Cyprus + UAE are legit 0%-VAT countries)
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not a 0%-VAT country (Cyprus/UAE) and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not coalesce(d.payment_method='cash' and not coalesce(d.cash_charge_vat,false), false)
       and coalesce(c.country,'') not ilike 'cyprus'
       and coalesce(c.country,'') not ilike 'united arab emirates'
    union all
    -- 4 vat_odd_rate
    select 'vat_odd_rate','grey','money','job', j.id, j.code, 'Unusual VAT rate',
           'VAT rate = '||j.vat_rate::text||'% (not 0 or 24)', j.deal_id, j.id, j.vat_rate::text
      from jobs j where not j.archived and j.vat_rate is not null and j.vat_rate not in (0,24)
    union all
    -- 5 aiseo_child_amount
    select 'aiseo_child_amount','red','money','job', j.id, j.code, 'AI-SEO child carries an amount',
           'Child job has a non-zero amount (should bill on the parent)', j.deal_id, j.id, ''
      from jobs j where not j.archived and j.parent_job_id is not null
       and (coalesce(j.amount_net,0)>0 or coalesce(j.monthly_amount,0)>0 or coalesce(j.one_time_amount,0)>0)
    union all
    -- 6 duplicate_period
    select 'duplicate_period','red','lifecycle','deal', dp.deal_id,
           (select code from deals where id=dp.deal_id),
           'Duplicate billing period',
           coalesce(dp.service_type,'?')||' '||dp.start_date::text||'→'||dp.end_date::text||' billed '||count(*)::text||'×',
           dp.deal_id, null::uuid, dp.service_type||':'||dp.start_date::text||':'||dp.end_date::text
      from deal_payments dp
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.start_date is not null and dp.end_date is not null and dp.status<>'cancelled'
     group by dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date
     having count(*)>=2
    union all
    -- 7 paid_in_full_but_owes
    select 'paid_in_full_but_owes','red','lifecycle','deal', d.id, d.code,
           'Marked Paid In Full but still owes', 'Has an unpaid payment already past due', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='paid_in_full'
       and exists (select 1 from deal_payments p where p.deal_id=d.id
                    and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 8 on_hold_not_overdue
    select 'on_hold_not_overdue','amber','lifecycle','deal', d.id, d.code,
           'On Hold but nothing overdue', 'Held with no past-due unpaid payment', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments p where p.deal_id=d.id
                        and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 9 stale_block
    select 'stale_block','amber','lifecycle','job', j.id, j.code, 'Stale "account on hold" block',
           'Job blocked account_on_hold but its deal is not on hold', j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.is_blocked and j.blocked_reason='account_on_hold' and ps.code<>'on_hold'
    union all
    -- 10 renewal_past_due
    select 'renewal_past_due','grey','lifecycle','job', j.id, j.code, 'Renewal past due date',
           'Renewal job due '||j.period_due_date::text, j.deal_id, j.id, j.period_due_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and s.code='renewal' and j.period_due_date is not null and j.period_due_date < current_date
    union all
    -- 11 billing_gap: recurring billing has STALLED — no period covers today.
    select 'billing_gap','red','lifecycle','deal', d.id, d.code, 'Recurring billing has stalled',
           'No billing period covers today (schedule lapsed)', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done','on_hold')
       and exists (select 1 from jobs j where j.deal_id=d.id and j.billing_active and not j.archived
                    and j.billing_type in ('recurring_monthly','recurring_yearly'))
       and not exists (select 1 from deal_payments p where p.deal_id=d.id and p.status<>'cancelled'
                        and p.start_date <= current_date and p.end_date >= current_date)
    union all
    -- 12 no_payment_method
    select 'no_payment_method','amber','missing','deal', d.id, d.code, 'No payment method',
           'Deal has no payment method set', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and nullif(trim(coalesce(d.payment_method,'')),'') is null
    union all
    -- 13 bad_email
    select 'bad_email','amber','missing','client', c.id, coalesce(c.code, left(c.id::text,8)), 'Bad or missing client email',
           coalesce(c.email,'(empty)'), null::uuid, null::uuid, coalesce(c.email,'')
      from clients c
     where not c.archived and coalesce(c.status,'') <> 'done'
       and (c.email is null or trim(c.email)='' or c.email like '% - %'
            or c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    union all
    -- 14 won_deal_no_services
    select 'won_deal_no_services','amber','missing','deal', d.id, d.code, 'Won deal with no services',
           'No services planned and no jobs', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(jsonb_array_length(d.services_planned),0)=0
       and not exists (select 1 from jobs j where j.deal_id=d.id and not j.archived)
    union all
    -- 15 cash_deal_with_vat: deal chose cash + no-VAT, yet a job still charges VAT
    select 'cash_deal_with_vat','amber','possible_mistakes','job', j.id, j.code,
           'Cash deal but VAT charged',
           'Deal is cash + no-VAT, but this job has VAT '||j.vat_rate::text||'%',
           j.deal_id, j.id, j.vat_rate::text
      from jobs j join deals d on d.id=j.deal_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)>0
       and d.payment_method='cash' and not coalesce(d.cash_charge_vat,false)
    union all
    -- 16 duplicate_vat_number: two+ active clients share a VAT number
    select 'duplicate_vat_number','amber','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Duplicate VAT number', 'VAT '||c.vat_number||' is shared by another client',
           null::uuid, null::uuid, c.vat_number
      from clients c
     where not c.archived and nullif(trim(coalesce(c.vat_number,'')),'') is not null
       and exists (select 1 from clients c2 where c2.id<>c.id and not c2.archived
                    and trim(coalesce(c2.vat_number,''))=trim(c.vat_number))
    union all
    -- 17 deal_value_mismatch: deal's monthly value != sum of its recurring job amounts
    select 'deal_value_mismatch','grey','possible_mistakes','deal', d.id, d.code,
           'Deal value differs from its jobs',
           'Monthly value E'||coalesce(d.recurring_monthly_value,0)::text||' vs jobs E'||js.jobsum::text,
           d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
      join lateral (select coalesce(sum(j.amount_net),0) as jobsum from jobs j
                     where j.deal_id=d.id and not j.archived and j.billing_active
                       and j.billing_type in ('recurring_monthly','recurring_yearly')) js on true
     where not d.archived and ps.code not in ('closed','done')
       and js.jobsum>0 and coalesce(d.recurring_monthly_value,0)>0
       and abs(coalesce(d.recurring_monthly_value,0)-js.jobsum)>=1
    union all
    -- 18 large_recurring_amount: an unusually large recurring amount (possible typo)
    select 'large_recurring_amount','grey','possible_mistakes','job', j.id, j.code,
           'Unusually large recurring amount', 'Recurring E'||j.amount_net::text||' / period',
           j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)>3000
    union all
    -- 19 test_client_name: client name looks like a test/placeholder
    select 'test_client_name','grey','possible_mistakes','client', c.id, coalesce(c.code, left(c.id::text,8)),
           'Test-looking client name', 'Client name: '||c.name, null::uuid, null::uuid, ''
      from clients c
     where not c.archived and coalesce(c.status,'')<>'done'
       and (c.name ilike '%test%' or c.name ilike '%δοκιμ%' or c.name ilike '%asdf%'
            or c.name ilike '%xxx%' or c.name ilike '%qwerty%')
    union all
    -- 20 off_board_job: active service job on a Paid-In-Full deal with no board stage
    select 'off_board_job','red','lifecycle','job', j.id, j.code, 'Job not on its board',
           'Active job on a Paid-In-Full deal has no board stage (off-board)',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.status='active' and coalesce(j.billing_only,false)=false
       and j.stage_id is null and ps.code='paid_in_full'
       and j.service_type in ('local_seo','web_seo','web_dev','social_media','hosting','ads','maintenance','franchise','domains')
    union all
    -- 21 seo_renewal_pending: a PAID cycle the card was never renewed for.
    --     Mirrors seo_sync_renewal_job's guard (20260804090000). Normally empty —
    --     the move is automatic — so a row here means the move itself failed.
    select 'seo_renewal_pending','red','lifecycle','job', j.id, j.code,
           'Paid cycle not sent to Renewal',
           'Period from '||j.period_start_date::text||' is paid but the card sits in '||
             coalesce(s.code,'?')||' (last renewed for '||
             coalesce(j.renewed_for_period::text,'never')||')',
           j.deal_id, j.id, j.period_start_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and not s.is_terminal and s.code <> 'renewal'
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and j.period_start_date is not null
       and j.period_start_date > coalesce(j.renewed_for_period,
                                          (j.onboarded_at + interval '14 days')::date)
    union all
    -- 22 seo_job_no_period: client has paid on this deal, job has no period at all.
    --     recompute_job_period_dates matches on service_type AND billing_type, so a
    --     mis-keyed payment leaves the job dateless and every guard downstream
    --     (renewal, due chips, reminders) silently no-ops.
    --     Live cards only: on a terminal lane the missing period is history, not a
    --     defect (6 of the 14 matches on 2026-08-04 were closed engagements).
    select 'seo_job_no_period','red','lifecycle','job', j.id, j.code,
           'Paid deal but job has no billing period',
           'No paid payment matches this job on service type + billing type',
           j.deal_id, j.id, ''
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and j.period_start_date is null
       and not s.is_terminal and j.status='active'
       and j.service_type in ('web_seo','local_seo')
       and j.onboarded_at is not null
       and exists (select 1 from deal_payments p
                    where p.deal_id=j.deal_id and p.status='paid')
    union all
    -- 23 paid_period_no_job: the same defect seen from the payment side.
    select 'paid_period_no_job','amber','lifecycle','deal', p.deal_id,
           (select code from deals where id=p.deal_id),
           'Paid period matches no job',
           'Paid '||coalesce(p.service_type,'(no service)')||' '||
             coalesce(p.start_date::text,'?')||' has no live job of that service on the deal',
           p.deal_id, null::uuid,
           coalesce(p.service_type,'')||':'||coalesce(p.start_date::text,'')
      from deal_payments p join deals d on d.id=p.deal_id
     where p.status='paid' and not d.archived and p.service_type is not null
       and not exists (select 1 from jobs j
                        where j.deal_id=p.deal_id and not j.archived
                          and j.service_type=p.service_type)
       and not exists (select 1 from deal_payment_lines l where l.payment_id=p.id)
    union all
    -- 24 service_card_not_billing: a live card whose service nobody bills.
    --     ensure_recurring_payments() only extends a period when a NON-archived,
    --     billing_active job of the same service_type + billing_type exists, so
    --     clearing billing_active on the last such job stops the schedule for
    --     ever — silently, because billing_gap (check 11) needs a billing_active
    --     recurring job to fire at all. Deal 000403 ran two months this way.
    --     Exclusions, each measured on prod 2026-08-04 (131 -> 10 rows):
    --       parent_job_id / billing_only  AI-SEO trio children bill on the parent (-96)
    --       ai_seo parent on the deal     same structure, seen from the child (-2)
    --       amount_net = 0                bundled or free, nothing to bill (-2)
    --       deal stage closed/done        finished engagement, stale card (-20)
    --       status <> 'active'            the team ended the work (-1)
    select 'service_card_not_billing','red','lifecycle','job', j.id, j.code,
           'Live service card with no active billing',
           'Card is live and bills EUR '||j.amount_net::text||'/period, but no '||
             'billing_active recurring job covers '||j.service_type||' on this deal',
           j.deal_id, j.id, ''
      from jobs j
      join pipeline_stages s on s.id = j.stage_id
      join deals d on d.id = j.deal_id
      join pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived and not d.archived and not s.is_terminal
       and ps.code not in ('closed','done')
       and j.status = 'active'
       and j.service_type in ('web_seo','local_seo','ads','social_media','maintenance')
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and not j.billing_active
       and j.parent_job_id is null
       and not coalesce(j.billing_only, false)
       and coalesce(j.amount_net, 0) > 0
       and not exists (select 1 from jobs j2
                        where j2.deal_id = j.deal_id and not j2.archived
                          and j2.service_type = j.service_type and j2.billing_active)
       and not exists (select 1 from jobs p
                        where p.deal_id = j.deal_id and not p.archived
                          and p.billing_active and p.service_type = 'ai_seo')
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $function$
;
