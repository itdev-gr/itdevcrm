-- =============================================================================
-- 2026-09-04 (owner): «000249 εδώ έχει γίνει λάθος στο web dev. δεν είναι 1
-- payment αλλά 50/50» — plus «θέλω να μου ανοίξεις hosting 120 ευρώ + ΦΠΑ».
--
-- Deal 000249, ΤΡΑΠΑΛΗ ΒΑΣΙΛΙΚΗ & ΣΙΑ Ε.Ε. Two corrections, one addition:
--
--   * the web dev job was recorded as ONE payment of 450 net. The agreement is
--     50/50 and — the owner was explicit, «σου λέω καθαρό ποσό» — EACH
--     instalment is 450, so the job is worth 900 net, not 450.
--       instalment 1/2 : 450, already paid (30/04/2026, the existing row)
--       instalment 2/2 : 450, unpaid
--   * hosting was never opened on this deal: 120 net + 24% VAT, yearly,
--     aligned to the domain's 19/06 renewal date at the owner's request.
--   * with 450 + 120 now outstanding, the accounting stage moves off
--     «Πλήρως Εξοφλημένο» back to «Μερική Πληρωμή» (owner's decision).
--
-- WHY THIS IS A MIGRATION AND NOT A UI CHANGE: update_job_billing accepts
-- '50_50' happily, but refuses with `cannot_replan_paid_installment` when any
-- payment of the job is already `paid` or invoiced — it will not silently
-- rewrite settled history, and it should not. This does it once, deliberately,
-- in the open. The paid row is NOT deleted and re-created: it is relabelled
-- 1/2 in place, so its paid_at of 30/04/2026 and its identity survive.
--
-- The shape produced here matches generate_payments_for_deal's own 50_50
-- output exactly — 'Installment 1/2' / 'Installment 2/2', a payment line per
-- instalment, no due date on the second — so the card reads like the 18 other
-- web_dev jobs already on a 50/50 plan.
--
-- first_paid_in_full_at is left alone and cannot be lost:
-- deals_stamp_first_paid_in_full is write-once (it copies old→new whenever a
-- value already exists). That matters, because clearing it would make the
-- first-payment gate from 20260904100000 treat this deal as never paid.
--
-- Every step asserts it matched exactly one row; anything unexpected raises and
-- the whole transaction rolls back.
-- =============================================================================

do $$
declare
  v_deal        uuid;
  v_client      uuid;
  v_job         uuid;
  v_pay         uuid;
  v_vat         numeric;
  v_group       uuid;
  v_stage       uuid;
  v_code        text;
  v_pay2        uuid;
  v_hosting_job uuid;
  v_hosting_pay uuid;
  v_partial     uuid;
  v_n           int;
begin
  ---------------------------------------------------------------- the deal ----
  select d.id, d.client_id, d.code into v_deal, v_client, v_code
    from public.deals d where d.code = '000249';
  if v_deal is null then
    raise exception 'deal 000249 not found';
  end if;

  ------------------------------------------------------- 1. the web dev job ---
  select j.id, coalesce(j.vat_rate, 24) into v_job, v_vat
    from public.jobs j
   where j.deal_id = v_deal and j.service_type = 'web_dev' and not j.archived;
  if v_job is null then
    raise exception 'no active web_dev job on 000249';
  end if;

  update public.jobs
     set amount_net = 900,
         installment_plan = '50_50'
   where id = v_job;

  ------------------------------------------------- 2. the paid row becomes 1/2 -
  select p.id into v_pay
    from public.deal_payments p
    join public.deal_payment_lines l on l.payment_id = p.id
   where p.deal_id = v_deal and l.job_id = v_job;
  if v_pay is null then
    raise exception 'the existing web_dev payment of 000249 was not found';
  end if;

  select count(*) into v_n
    from public.deal_payments p
    join public.deal_payment_lines l on l.payment_id = p.id
   where p.deal_id = v_deal and l.job_id = v_job;
  if v_n <> 1 then
    raise exception 'expected exactly 1 existing web_dev payment, found %', v_n;
  end if;

  -- Amount and paid_at deliberately untouched: 450 was paid, on 30/04/2026.
  update public.deal_payments
     set label = 'Installment 1/2'
   where id = v_pay;

  update public.deal_payment_lines
     set label = 'Website (1/2)'
   where payment_id = v_pay and job_id = v_job;

  ------------------------------------------------------- 3. the second half ---
  insert into public.deal_payments
    (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate, label)
  values
    (v_deal, 'web_dev', 'one_time', null, null, 'pending', 450, v_vat, 'Installment 2/2')
  returning id into v_pay2;

  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
  values (v_pay2, v_job, 'Website (2/2)', 450, v_vat);

  ------------------------------------------------------------- 4. hosting -----
  if exists (select 1 from public.jobs j
              where j.deal_id = v_deal and j.service_type = 'hosting' and not j.archived) then
    raise exception '000249 already has an active hosting job — nothing to open';
  end if;

  select id into v_group from public.groups where code = 'hosting';
  select id into v_stage from public.pipeline_stages
   where board = 'hosting' and not archived order by position limit 1;

  insert into public.jobs
    (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, setup_fee,
     title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
     period_start_date, started_at, code)
  values
    (v_deal, v_client, 'hosting', 'recurring_yearly', 120, 24, 0,
     'Hosting', true, false, true, 'active', v_stage, v_group,
     date '2026-06-19', now(), v_code)
  returning id into v_hosting_job;

  -- Aligned to the domain's 19/06 anniversary, per the owner. The current year
  -- is charged, so this payment is due now rather than in June 2027.
  insert into public.deal_payments
    (deal_id, service_type, billing_type, start_date, end_date, status, amount_net, vat_rate)
  values
    (v_deal, 'hosting', 'recurring_yearly', date '2026-06-19', date '2027-06-19', 'pending', 120, 24)
  returning id into v_hosting_pay;

  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
  values (v_hosting_pay, v_hosting_job, 'Hosting', 120, 24);

  ------------------------------------------------- 5. back to partial payment --
  select id into v_partial from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'partial_payment';
  if v_partial is null then
    raise exception 'accounting_onboarding.partial_payment stage not found';
  end if;

  update public.deals set accounting_stage_id = v_partial where id = v_deal;

  ------------------------------------------------------------- 6. assertions --
  select count(*) into v_n
    from public.deal_payments p
    join public.deal_payment_lines l on l.payment_id = p.id
   where p.deal_id = v_deal and l.job_id = v_job;
  if v_n <> 2 then
    raise exception 'web_dev should end with exactly 2 instalments, found %', v_n;
  end if;

  if (select sum(p.amount_net)
        from public.deal_payments p
        join public.deal_payment_lines l on l.payment_id = p.id
       where p.deal_id = v_deal and l.job_id = v_job) <> 900 then
    raise exception 'the two web_dev instalments do not add up to 900';
  end if;

  if (select d.first_paid_in_full_at from public.deals d where d.id = v_deal) is null then
    raise exception 'first_paid_in_full_at was lost — it must survive the stage move';
  end if;
end $$;

-- ROLLBACK:
--   update public.jobs set amount_net = 450, installment_plan = 'none'
--    where deal_id = (select id from public.deals where code='000249')
--      and service_type = 'web_dev' and not archived;
--   delete from public.deal_payments p
--    where p.deal_id = (select id from public.deals where code='000249')
--      and (p.label = 'Installment 2/2' or p.service_type = 'hosting');
--   update public.deal_payments set label = null
--    where deal_id = (select id from public.deals where code='000249') and label = 'Installment 1/2';
--   update public.deal_payment_lines set label = 'Website'
--    where label = 'Website (1/2)';
--   delete from public.jobs where deal_id = (select id from public.deals where code='000249')
--     and service_type = 'hosting';
--   update public.deals set accounting_stage_id =
--     (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full')
--    where code = '000249';
