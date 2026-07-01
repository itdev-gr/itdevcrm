-- Per-job billing pause/resume harness — 8 scenarios (P1..P8).
--
-- Guards & mitigations under test (all live on prod as of 2026-07-02):
--   S1 deal_payments.status CHECK now includes 'cancelled'
--   S2 UNIQUE partial idx deal_payments_recurring_period_key_unique_v2 (excludes cancelled)
--   S3 state-machine fns treat 'cancelled' as invisible
--   S4 job_pause_billing / job_resume_billing RPCs (auth-gated: admin OR accounting)
--
-- How to run:
--   Each scenario is a single DO block, executed via MCP execute_sql.
--   The terminal `raise exception 'RESULT :: PASS|FAIL Pn :: ...'` aborts
--   the implicit transaction — NOTHING persists on prod. Any seeding done
--   before the raise is fully rolled back with the exception.
--
-- Auth stub:
--   The RPCs check auth.uid(). Setting the JWT claim inside the DO block is
--   sufficient (probe confirmed 2026-07-02) — no need to also set role:
--     perform set_config('request.jwt.claims',
--        json_build_object('sub', <admin_uid>)::text, true);
--
-- Notes:
--   * deal_payments has GENERATED cols vat_amount/amount_gross — never in
--     INSERT column lists.
--   * jobs requires deal_id, client_id, service_type, billing_type.
--     billing_active defaults true; is_blocked defaults false; archived
--     defaults false.
--   * A stage_id must be picked from public.pipeline_stages for the right
--     board (jobs stage boards match jobs.service_type; deals boards live on
--     'sales' + 'accounting_onboarding').
--   * The `deals_hold_jobs_on_hold` trigger runs on accounting_stage_id
--     transitions — factored in below.
--
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off

-- =====================================================================
-- P1 — pause cancels + flags
-- Seed: deal @ paid_in_full + ads job (billing_active=true) + 2 ads rows:
--   * old paid   [today-60, today-30]  (untouched)
--   * current overdue [today-30, today] (cancelled by pause)
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid; v_job uuid;
        v_paid_row uuid; v_overdue_row uuid; v_result jsonb;
        v_is_blocked bool; v_reason text; v_billing_active bool;
        v_paid_status text; v_overdue_status text;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P1', 'pause P1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_job;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'paid')
    returning id into v_paid_row;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'overdue')
    returning id into v_overdue_row;

  select public.job_pause_billing(v_job) into v_result;

  select is_blocked, blocked_reason, billing_active into v_is_blocked, v_reason, v_billing_active
    from public.jobs where id = v_job;
  select status into v_paid_status from public.deal_payments where id = v_paid_row;
  select status into v_overdue_status from public.deal_payments where id = v_overdue_row;

  if (v_result->>'payments_cancelled')::int <> 1 then
    raise exception 'RESULT :: FAIL P1 :: payments_cancelled expected 1 got % (result=%)',
      v_result->>'payments_cancelled', v_result::text;
  end if;
  if not v_is_blocked or v_reason is distinct from 'billing_paused' or v_billing_active then
    raise exception 'RESULT :: FAIL P1 :: job flags expected (blocked=t reason=billing_paused billing_active=f) got (%, %, %)',
      v_is_blocked, v_reason, v_billing_active;
  end if;
  if v_overdue_status <> 'cancelled' then
    raise exception 'RESULT :: FAIL P1 :: overdue row expected status=cancelled got %', v_overdue_status;
  end if;
  if v_paid_status <> 'paid' then
    raise exception 'RESULT :: FAIL P1 :: paid row expected untouched (paid) got %', v_paid_status;
  end if;
  raise exception 'RESULT :: PASS P1 :: pause cancelled overdue + flagged job billing_paused (result=%)', v_result::text;
end $$;

-- =====================================================================
-- P2 — cron silence after pause
-- Same P1 seed + pause. ensure_recurring_payments must not spawn a renewal
-- row for the paused chain (cancelled rows + billing_active=false both
-- exclude it from cron's WHERE).
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid; v_job uuid;
        v_before int; v_after int;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P2', 'pause P2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_job;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'overdue');

  perform public.job_pause_billing(v_job);

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL P2 :: cron delta expected 0 got % (before=%, after=%)',
      (v_after - v_before), v_before, v_after;
  end if;
  raise exception 'RESULT :: PASS P2 :: cron silent for paused chain (delta=0)';
end $$;

-- =====================================================================
-- P3 — user's exact flow
-- Seed: local_seo job + paid current row [today-15, today+15]
--       ads job + overdue row [today-30, today]
-- Pause ads. Assert:
--   * deal_next_due = NULL (cancelled ads + paid local_seo both skipped)
--   * After stage→paid_in_full + cron + mark_overdue + reconcile,
--     deal stage STAYS paid_in_full.
-- (local_seo end_date today+15 is > today+7 → cron won't renew it.)
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid;
        v_ads_job uuid; v_local_job uuid;
        v_next_due date; v_final_stage text;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P3', 'pause P3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true)
    returning id into v_local_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_ads_job;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'local_seo', 0, 'recurring_monthly', 200, 24,
            current_date - 15, current_date + 15, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'overdue');

  perform public.job_pause_billing(v_ads_job);

  select public.deal_next_due(v_deal) into v_next_due;
  if v_next_due is not null then
    raise exception 'RESULT :: FAIL P3 :: deal_next_due expected NULL got %', v_next_due;
  end if;

  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full')
   where id = v_deal;

  perform public.ensure_recurring_payments();
  perform public.mark_overdue_payments();
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_final_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_final_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL P3 :: deal expected paid_in_full got %', v_final_stage;
  end if;
  raise exception 'RESULT :: PASS P3 :: paused ads invisible to state machine; deal stays paid_in_full';
end $$;

-- =====================================================================
-- P4 — resume creates fresh pending period + moves deal to awaiting_payment
-- P1 seed + pause, then job_resume_billing(job). Assert:
--   * job unblocked, billing_active=true
--   * a new pending row exists with start=current_date, end=current_date+1mo
--   * deal accounting stage moved to awaiting_payment (move_to_awaiting
--     trigger fires on pending insert since paid_in_full is not terminal
--     and not in the skip-list)
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid; v_job uuid;
        v_pause_result jsonb; v_resume_result jsonb;
        v_is_blocked bool; v_reason text; v_billing_active bool;
        v_final_stage text; v_new_id uuid;
        v_new_start date; v_new_end date; v_new_status text;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P4', 'pause P4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_job;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'overdue');

  select public.job_pause_billing(v_job) into v_pause_result;
  select public.job_resume_billing(v_job) into v_resume_result;

  v_new_id := (v_resume_result->>'new_payment_id')::uuid;

  select is_blocked, blocked_reason, billing_active into v_is_blocked, v_reason, v_billing_active
    from public.jobs where id = v_job;
  if v_is_blocked or v_reason is not null or not v_billing_active then
    raise exception 'RESULT :: FAIL P4 :: job flags expected (blocked=f reason=null billing_active=t) got (%, %, %)',
      v_is_blocked, v_reason, v_billing_active;
  end if;

  if v_new_id is null then
    raise exception 'RESULT :: FAIL P4 :: expected new_payment_id, got null (result=%)', v_resume_result::text;
  end if;
  select start_date, end_date, status into v_new_start, v_new_end, v_new_status
    from public.deal_payments where id = v_new_id;
  if v_new_start <> current_date or v_new_end <> (current_date + interval '1 month')::date or v_new_status <> 'pending' then
    raise exception 'RESULT :: FAIL P4 :: new row expected (start=today, end=today+1mo, pending) got (%, %, %)',
      v_new_start, v_new_end, v_new_status;
  end if;

  select ps.code into v_final_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_final_stage <> 'awaiting_payment' then
    raise exception 'RESULT :: FAIL P4 :: deal expected awaiting_payment got %', v_final_stage;
  end if;
  raise exception 'RESULT :: PASS P4 :: resume unblocked job, inserted fresh pending [today,+1mo], moved deal to awaiting_payment (pause=%, resume=%)',
    v_pause_result::text, v_resume_result::text;
end $$;

-- =====================================================================
-- P5 — precedence: pause does not stomp account_on_hold on other chains
-- Seed: deal + ads job (billing_active=t, but pre-flagged account_on_hold)
--       + local_seo job (blocked account_on_hold, billing_active=t).
-- Pause ads → ads reason becomes billing_paused; local_seo reason STAYS
-- account_on_hold. Resume ads → ads unblocked; local_seo still on hold.
--
-- Note: we seed at 'awaiting_payment' to avoid deals_hold_jobs_on_hold /
-- release triggers changing our seeded block reasons; we set the block
-- flags directly on the jobs.
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid;
        v_ads_job uuid; v_local_job uuid;
        v_ads_reason text; v_local_reason text;
        v_ads_blocked bool; v_local_blocked bool;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P5', 'pause P5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active,
    is_blocked, blocked_reason, blocked_at)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true, true, 'account_on_hold', now())
    returning id into v_ads_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active,
    is_blocked, blocked_reason, blocked_at)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true, true, 'account_on_hold', now())
    returning id into v_local_job;

  perform public.job_pause_billing(v_ads_job);

  select is_blocked, blocked_reason into v_ads_blocked, v_ads_reason
    from public.jobs where id = v_ads_job;
  select is_blocked, blocked_reason into v_local_blocked, v_local_reason
    from public.jobs where id = v_local_job;
  if not v_ads_blocked or v_ads_reason is distinct from 'billing_paused' then
    raise exception 'RESULT :: FAIL P5a :: ads expected billing_paused, got (blocked=%, reason=%)', v_ads_blocked, v_ads_reason;
  end if;
  if not v_local_blocked or v_local_reason is distinct from 'account_on_hold' then
    raise exception 'RESULT :: FAIL P5a :: local_seo expected account_on_hold, got (blocked=%, reason=%)', v_local_blocked, v_local_reason;
  end if;

  perform public.job_resume_billing(v_ads_job);

  select is_blocked, blocked_reason into v_ads_blocked, v_ads_reason
    from public.jobs where id = v_ads_job;
  select is_blocked, blocked_reason into v_local_blocked, v_local_reason
    from public.jobs where id = v_local_job;
  if v_ads_blocked or v_ads_reason is not null then
    raise exception 'RESULT :: FAIL P5b :: ads expected unblocked, got (blocked=%, reason=%)', v_ads_blocked, v_ads_reason;
  end if;
  if not v_local_blocked or v_local_reason is distinct from 'account_on_hold' then
    raise exception 'RESULT :: FAIL P5b :: local_seo expected STILL account_on_hold, got (blocked=%, reason=%)', v_local_blocked, v_local_reason;
  end if;
  raise exception 'RESULT :: PASS P5 :: pause/resume only affect same-chain billing_paused jobs; account_on_hold peers preserved';
end $$;

-- =====================================================================
-- P6 — re-insert over cancelled row succeeds
-- P1 seed + pause. Insert a new pending row with SAME
-- (deal, service_type, billing_type, start_date, end_date) as the cancelled
-- overdue row. Both the L2 trigger AND the v2 UNIQUE index must allow it
-- (cancelled rows excluded). Insert must return a non-null id.
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid; v_job uuid;
        v_reused_start date; v_reused_end date; v_new_row uuid;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P6_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P6', 'pause P6', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_job;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'paid');
  v_reused_start := current_date - 30;
  v_reused_end   := current_date;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            v_reused_start, v_reused_end, 'overdue');

  perform public.job_pause_billing(v_job);

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            v_reused_start, v_reused_end, 'pending')
    returning id into v_new_row;

  if v_new_row is null then
    raise exception 'RESULT :: FAIL P6 :: re-insert over cancelled row was silently dropped (id null)';
  end if;
  raise exception 'RESULT :: PASS P6 :: re-insert over cancelled row succeeded (new_id=%)', v_new_row;
end $$;

-- =====================================================================
-- P7 — chain scope (two ads jobs, one deal, one pause call)
-- Both jobs billing_active. Pause via job #1. Assert jobs_flagged=2 AND
-- both rows now flagged billing_paused.
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid;
        v_job1 uuid; v_job2 uuid; v_result jsonb;
        v_r1 text; v_r2 text; v_b1 bool; v_b2 bool;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P7_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P7', 'pause P7', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_job1;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_job2;

  select public.job_pause_billing(v_job1) into v_result;

  if (v_result->>'jobs_flagged')::int <> 2 then
    raise exception 'RESULT :: FAIL P7 :: jobs_flagged expected 2 got % (result=%)',
      v_result->>'jobs_flagged', v_result::text;
  end if;
  select is_blocked, blocked_reason into v_b1, v_r1 from public.jobs where id = v_job1;
  select is_blocked, blocked_reason into v_b2, v_r2 from public.jobs where id = v_job2;
  if not v_b1 or v_r1 is distinct from 'billing_paused' or not v_b2 or v_r2 is distinct from 'billing_paused' then
    raise exception 'RESULT :: FAIL P7 :: expected both ads jobs billing_paused got (job1=%,%; job2=%,%)',
      v_b1, v_r1, v_b2, v_r2;
  end if;
  raise exception 'RESULT :: PASS P7 :: single pause call flagged both ads jobs in chain (result=%)', v_result::text;
end $$;

-- =====================================================================
-- P8 — release_from_on_hold ignores cancelled rows
-- Seed: deal @ on_hold + ads job + overdue ads row [today-30, today]
--       + local_seo job + overdue local row [today-30, today].
-- Pause ads (ads row → cancelled). UPDATE local row to 'paid'.
-- release_from_on_hold trigger sees no unpaid-non-cancelled past-due row
-- → promotes deal to paid_in_full.
--
-- Caveat: we set is_blocked=false on the seeded jobs BEFORE the on_hold
-- stage-move trigger runs by inserting the deal at on_hold from the start
-- (no stage transition on our jobs).
-- =====================================================================
do $$
declare v_admin uuid; v_client uuid; v_deal uuid;
        v_ads_job uuid; v_local_job uuid;
        v_ads_row uuid; v_local_row uuid; v_final_stage text;
begin
  select user_id into v_admin from public.profiles where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into public.clients (name) values ('pause_P8_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'PAUSE-P8', 'pause P8', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'ads', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ads' and not archived order by position limit 1),
            true)
    returning id into v_ads_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true)
    returning id into v_local_job;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ads', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'overdue')
    returning id into v_ads_row;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'local_seo', 0, 'recurring_monthly', 200, 24,
            current_date - 30, current_date, 'overdue')
    returning id into v_local_row;

  perform public.job_pause_billing(v_ads_job);
  update public.deal_payments set status='paid' where id = v_local_row;

  select ps.code into v_final_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_final_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL P8 :: expected paid_in_full after local paid + ads cancelled, got %', v_final_stage;
  end if;
  raise exception 'RESULT :: PASS P8 :: release_from_on_hold promoted deal to paid_in_full (cancelled ads row ignored)';
end $$;

-- ---------------------------------------------------------------------
-- End of harness. All 8 scenarios are DO blocks with terminal RAISE
-- EXCEPTION — nothing persists.
