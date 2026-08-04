# Accounting Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four accounting defects that are actively costing money or silently freezing billing, without changing any behaviour that is currently correct.

**Architecture:** Four independent fixes, each one small and each one verifiable against production inside a rolled-back transaction. Three are single-clause changes to an existing function; one is a return-shape contract fix between an RPC and its React hook. Two of them (Tasks 3 and 4) change observable behaviour and are therefore gated on an explicit owner decision recorded in the task itself.

**Tech Stack:** Postgres 17 / Supabase (`public` schema, SECURITY DEFINER RPCs, pgTAP tests in `supabase/tests/`), React + TanStack Query, i18n `en`/`el`.

**Source:** every finding, its evidence and its live row counts are in `docs/system-analysis/2026-08-04-accounting-full-audit.md`. Read the referenced section before starting a task.

## Scope note

The audit produced more than this plan fixes. Deliberately **not** in scope here, each deserving its own plan once these land: overlap detection as a new integrity check (A6), job-price propagation to the recurring schedule (A7), mixed-rate group VAT and ledger mutability (A7b), the frontend permission-gate and cache-invalidation gaps (A8), and the six behaviour-preserving simplifications (D). Data repairs (E) are owner decisions, not engineering tasks, and are listed at the end as a runbook rather than as tasks.

## Global Constraints

- **This machine has no node/npm, no supabase CLI, no psql, and no `node_modules`.** SQL reaches production only through the Management API: `POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query` with `{"query": "..."}` and a `sbp_…` bearer token, sent **with curl** (python `urllib` gets `403 error code: 1010` from Cloudflare). A whole migration file posted as one `query` runs in a single implicit transaction, so an error rolls the file back.
- **Verify every migration before applying it** by posting `begin;` + the file + a `select md5(pg_get_functiondef(oid))` + `rollback;`. The md5 inside the transaction proves it compiled; re-reading the md5 afterwards proves the rollback worked. This pattern was used successfully on 2026-08-04 for `20260805090000`.
- **`auth.uid()` is NULL over that API**, so permission-gated RPCs refuse. To exercise one in a test, inject an identity first: `select set_config('request.jwt.claims', '{"sub":"<admin uuid>","role":"authenticated"}', true);` — the house pattern is in `supabase/tests/create_custom_job_ai_seo_trio.sql`.
- **Drift-check before editing any function**: read `md5(pg_get_functiondef(oid))` live and compare against the newest repo emission (`grep -l '<fn>' supabase/migrations/*.sql | sort | tail -1`). Record the pre-change md5 in the migration header. Re-emitting a function replaces it wholesale, so any unintended edit is a production defect.
- **Every migration carries a `ROLLBACK:` comment block** naming the migration that restores the previous body. Filenames are `YYYYMMDDHHMMSS_snake_name.sql`; the newest applied is `20260805090000`.
- **pgTAP tests** live in `supabase/tests/`, wrapped `begin; select plan(N); … select * from finish(); rollback;`. Do not open a test with `delete from public.jobs …` — jobs are referenced by `email_messages` and the delete fails on the foreign key; select a deal that lacks the jobs you need instead.
- Money columns are `numeric(12,2)` on `deals` and `numeric(12,4)` on `deal_payments.amount_net`. Standard VAT is 24%; Cyprus and UAE are legitimately 0%.
- **`activity_log.action` is CHECK-limited to `insert`/`update`/`delete`**; the semantic name goes in `changes->>'kind'`.

---

### Task 1: Make pause/resume billing tell the truth

Audit reference: A1. This is the highest-leverage fix in the plan — it is one key in a JSON object, and it stops the mechanism that produced 40 paused jobs, 233 recurring jobs with billing off and 56 cancelled rows, all while telling operators the action had failed.

**Files:**
- Create: `supabase/migrations/20260806090000_job_billing_pause_ok_contract.sql`
- Create: `supabase/tests/job_billing_pause_contract.sql`
- Reference (newest emission, copy the bodies from here): `supabase/migrations/20260702100000_job_billing_pause.sql`

**Interfaces:**
- Consumes: `public.job_pause_billing(p_job_id uuid) returns jsonb`, `public.job_resume_billing(p_job_id uuid) returns jsonb` — signatures unchanged.
- Produces: both now return an `ok` boolean alongside their existing keys, matching the `PauseResult` shape that `src/features/jobs/hooks/useJobBillingPause.ts` already expects and that the sibling RPCs in `20260617000011_job_billing_rpcs.sql` already follow.

- [ ] **Step 1: Confirm the defect before changing anything**

Read both live bodies and the hook:

```sql
select proname, pg_get_functiondef(oid) ilike '%''ok''%' as has_ok_key
  from pg_proc where proname in ('job_pause_billing','job_resume_billing');
```

Expected: `has_ok_key = false` for both. Then read `src/features/jobs/hooks/useJobBillingPause.ts` lines 25-50 and confirm both hooks throw when `result.ok` is falsy. Record both md5s.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/job_billing_pause_contract.sql`:

```sql
-- supabase/tests/job_billing_pause_contract.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(4);

select set_config('request.jwt.claims',
                  '{"sub":"61b53075-398f-43a0-86f6-8bce177b669b","role":"authenticated"}', true);

do $$
declare v_deal uuid; v_client uuid; v_job uuid; v_stage uuid;
begin
  select d.id, d.client_id into v_deal, v_client
    from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
     and not exists (select 1 from public.jobs j
                      where j.deal_id = d.id and j.service_type = 'local_seo')
   limit 1;
  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', false, now(),
            (select code from public.deals where id = v_deal)||'-PAUSETEST', true)
    returning id into v_job;

  perform set_config('t.job', v_job::text, true);
  perform set_config('t.pause',  public.job_pause_billing(v_job)::text,  true);
  perform set_config('t.resume', public.job_resume_billing(v_job)::text, true);
end $$;

select is((current_setting('t.pause')::jsonb ->> 'ok'), 'true',
          'pause reports ok so the UI does not throw');
select isnt((current_setting('t.pause')::jsonb ->> 'payments_cancelled'), null,
            'pause still reports how many rows it cancelled');
select is((current_setting('t.resume')::jsonb ->> 'ok'), 'true',
          'resume reports ok so the UI does not throw');
select isnt((current_setting('t.resume')::jsonb ->> 'new_payment_id'), null,
            'resume still reports the payment it created');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `supabase test db --file supabase/tests/job_billing_pause_contract.sql`
Expected: assertions 1 and 3 FAIL (`ok` is NULL), 2 and 4 PASS.

If no CLI is available, post the same block through the Management API wrapped in `begin; … rollback;` and read the four values directly.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260806090000_job_billing_pause_ok_contract.sql`. Copy both function bodies verbatim from the live definitions read in Step 1 and change **only** the final `return` of each:

```sql
  -- job_pause_billing
  return jsonb_build_object('ok', true,
                            'jobs_flagged', v_flagged,
                            'payments_cancelled', v_cancelled);
```

```sql
  -- job_resume_billing
  return jsonb_build_object('ok', true,
                            'jobs_unflagged', v_unflagged,
                            'new_payment_id', v_new_id,
                            'next_start', current_date,
                            'next_end', v_next_end);
```

Every early `raise exception` in those functions stays exactly as it is — the hook surfaces a thrown Postgres error correctly already; only the success path was broken.

Header must explain WHY (the hook requires `ok`; every success surfaced as `unknown_error`; cache was never invalidated so the UI kept showing billing active after the database had cancelled the unpaid rows), carry both pre-change md5s, and a `ROLLBACK:` block pointing at `20260702100000_job_billing_pause.sql`.

- [ ] **Step 5: Run the test and watch it pass**

Run: `supabase test db --file supabase/tests/job_billing_pause_contract.sql`
Expected: 4/4 PASS.

- [ ] **Step 6: Verify against production in a rolled-back transaction, then apply**

Dry-run the migration wrapped in `begin; … select md5(pg_get_functiondef(oid)) …; rollback;`, confirm the md5 changes inside the transaction and reverts after it, then apply for real and record the post-change md5s in the header.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260806090000_job_billing_pause_ok_contract.sql \
        supabase/tests/job_billing_pause_contract.sql
git commit -m "fix(billing): pause/resume RPCs return ok so the UI stops reporting false failures"
```

---

### Task 2: Stop cancelled rows from driving the renewal generator

Audit reference: A5. Live evidence: 36 of 374 recurring chains have a cancelled row as their newest period; 7 are already stale; 4 services with `billing_active = true` have no live period covering today.

**Files:**
- Create: `supabase/migrations/20260806091000_ensure_recurring_ignores_cancelled.sql`
- Create: `supabase/tests/ensure_recurring_cancelled.sql`
- Reference (newest emission): `supabase/migrations/20260714090000_payment_line_amount_sync.sql`

**Interfaces:**
- Consumes: `public.ensure_recurring_payments() returns integer` — signature unchanged, still called by the `daily_ensure_recurring_payments` cron at 02:00 UTC.
- Produces: the same function, now blind to `status = 'cancelled'` rows both when choosing the row to extend and in its successor guard.

- [ ] **Step 1: Drift-check and read the live body**

```sql
select md5(pg_get_functiondef(oid)) from pg_proc where proname = 'ensure_recurring_payments';
```

Compare against the emission in `20260714090000_payment_line_amount_sync.sql`. Save the live body to a file and copy from that file — it is the base.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/ensure_recurring_cancelled.sql`:

```sql
-- supabase/tests/ensure_recurring_cancelled.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(2);

do $$
declare v_deal uuid; v_client uuid; v_job uuid; v_stage uuid; v_before int; v_after int;
begin
  select d.id, d.client_id into v_deal, v_client
    from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
     and not exists (select 1 from public.jobs j
                      where j.deal_id = d.id and j.service_type = 'local_seo')
     and not exists (select 1 from public.deal_payments p
                      where p.deal_id = d.id and p.service_type = 'local_seo')
   limit 1;
  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '60 days', false, now(),
            (select code from public.deals where id = v_deal)||'-CANCTEST', true)
    returning id into v_job;

  -- A paid period that ended a month ago, and a CANCELLED period after it.
  -- The cancelled row must neither be extended nor block the paid row's successor.
  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 250, 24,
            'paid', current_date - 60, current_date - 30);
  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 250, 24,
            'cancelled', current_date - 30, current_date);

  select count(*) into v_before from public.deal_payments
   where deal_id = v_deal and service_type = 'local_seo' and status <> 'cancelled';
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments
   where deal_id = v_deal and service_type = 'local_seo' and status <> 'cancelled';

  perform set_config('t.deal', v_deal::text, true);
  perform set_config('t.grew', (v_after > v_before)::text, true);
end $$;

select is(current_setting('t.grew'), 'true',
          'a cancelled tip does not block the next period');
select is((select count(*)::text from public.deal_payments
            where deal_id = current_setting('t.deal')::uuid
              and service_type = 'local_seo' and status = 'cancelled'),
          '1', 'the cancelled row was not extended into a new period');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `supabase test db --file supabase/tests/ensure_recurring_cancelled.sql`
Expected: assertion 1 FAILS — the cancelled row has the latest `end_date`, so the successor guard suppresses generation and nothing new appears.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260806091000_ensure_recurring_ignores_cancelled.sql`, copying the live body from Step 1 and adding the status filter in exactly two places.

In the driving `for r in select dp.* … where` clause, alongside the existing predicates:

```sql
       and dp.status <> 'cancelled'
```

And inside the successor guard's `not exists`:

```sql
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_type is not distinct from dp.service_type
            and dp2.billing_type = dp.billing_type
            and dp2.status <> 'cancelled'
            and dp2.end_date is not null
            and dp2.end_date > dp.end_date
       )
```

Change nothing else. Header must explain WHY (pause cancels unpaid rows; a cancelled row could both seed a successor — back-billing a deliberately voided period — and block a legitimate renewal; 36 chains live in that state), carry the pre-change md5, and a `ROLLBACK:` block pointing at `20260714090000_payment_line_amount_sync.sql`.

- [ ] **Step 5: Run the test and watch it pass**

Run: `supabase test db --file supabase/tests/ensure_recurring_cancelled.sql`
Expected: 2/2 PASS.

- [ ] **Step 6: Measure the blast radius before applying**

This changes what tonight's cron will generate. Run this first and record the answer:

```sql
select count(*) as chains_that_will_resume
  from (select p.deal_id, p.service_type, p.billing_type, max(p.end_date) as last_end
          from public.deal_payments p
         where p.billing_type in ('recurring_monthly','recurring_yearly')
           and p.end_date is not null and p.status <> 'cancelled'
         group by 1,2,3) live
 where live.last_end <= current_date + 7
   and exists (select 1 from public.jobs j
                where j.deal_id = live.deal_id and not j.archived and j.billing_active
                  and j.service_type = live.service_type
                  and j.billing_type = live.billing_type);
```

Every chain counted here will get a period generated on the next cron run. If the number is larger than about 40, stop and show the owner the list before applying — a burst of new unpaid periods moves deals to `on_hold` and arms reminder emails.

- [ ] **Step 7: Dry-run, apply, commit**

Dry-run wrapped in `begin; … rollback;`, apply, record the post-change md5, then:

```bash
git add supabase/migrations/20260806091000_ensure_recurring_ignores_cancelled.sql \
        supabase/tests/ensure_recurring_cancelled.sql
git commit -m "fix(billing): renewal generator ignores cancelled periods"
```

---

### Task 3: Let `partial_payment` deals settle — GATED ON AN OWNER DECISION

Audit reference: A2. **Do not start this task until the owner has answered the question in Step 1.** 17 deals are affected and the change alters which stage they land in.

**Files:**
- Create: `supabase/migrations/20260806092000_reconcile_partial_payment.sql`
- Create: `supabase/tests/reconcile_partial_payment.sql`
- Reference (newest emission): the live body of `reconcile_deal_stage`, plus `supabase/migrations/20260702150150_reconcile_deal_stage_respect_holds.sql` for the design note it carries.

**Interfaces:**
- Consumes: `public.reconcile_deal_stage(p_deal_id uuid) returns boolean`, called by the `deal_payments_reconcile_stage` trigger on every `deal_payments` write.
- Produces: the same function, with `partial_payment` added to the allow-list so a deal in that stage is re-evaluated like any other.

- [ ] **Step 1: Get the owner's decision, and record their exact words in the migration header**

Ask: *"A deal in Partial Payment never leaves that stage on its own today — 17 deals are sitting there, 10 with recurring services that can therefore never renew, and one (000041) owes €0 since June. Should paying off a Partial Payment deal move it automatically like any other stage — to Paid In Full when nothing is due, Awaiting Payment when something is due within 7 days, On Hold when something is overdue? Or is Partial Payment deliberately a manual-only column that an accountant must clear by hand?"*

If the answer is "manual only", **stop — close this task as not-to-be-done** and instead propose an integrity alert that lists Partial Payment deals owing nothing, so they are at least visible. Do not implement the rest of this task.

If the answer is "move it automatically", continue.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/reconcile_partial_payment.sql`:

```sql
-- supabase/tests/reconcile_partial_payment.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(2);

do $$
declare v_deal uuid; v_partial uuid; v_paid uuid;
begin
  select id into v_partial from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'partial_payment' limit 1;
  select id into v_paid from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

  select d.id into v_deal from public.deals d
   where d.code is not null and not d.archived and d.payment_method is not null
   limit 1;

  -- Park the deal in partial_payment with nothing owed.
  update public.deals set accounting_stage_id = v_partial where id = v_deal;
  update public.deal_payments set status = 'paid', paid_at = coalesce(paid_at, now())
   where deal_id = v_deal and status not in ('paid','cancelled');

  perform public.reconcile_deal_stage(v_deal);
  perform set_config('t.deal', v_deal::text, true);
  perform set_config('t.paid_stage', v_paid::text, true);
end $$;

select is((select accounting_stage_id from public.deals where id = current_setting('t.deal')::uuid),
          current_setting('t.paid_stage')::uuid,
          'a fully paid partial_payment deal settles to paid_in_full');
select is((select count(*)::text from public.deal_payments
            where deal_id = current_setting('t.deal')::uuid
              and status not in ('paid','cancelled')),
          '0', 'the fixture really did leave nothing owed');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `supabase test db --file supabase/tests/reconcile_partial_payment.sql`
Expected: assertion 1 FAILS — the deal is still in `partial_payment` because the function returned early.

- [ ] **Step 4: Write the migration**

Copy the live `reconcile_deal_stage` body and change the allow-list on the early return, and nothing else:

```sql
  if cur_code is null
     or cur_code not in ('awaiting_payment','on_hold','paid_in_full','partial_payment')
     or not v_pm then
    return false;
  end if;
```

Leave the `on_hold` branch exactly as it is — holds must still never be auto-lifted; that is a deliberate design decision recorded in `20260702150150`, and this change must not weaken it.

Header must quote the owner's decision from Step 1, explain the 17-deal situation, carry the pre-change md5, and a `ROLLBACK:` block.

- [ ] **Step 5: Run the test and watch it pass**

Run: `supabase test db --file supabase/tests/reconcile_partial_payment.sql`
Expected: 2/2 PASS.

- [ ] **Step 6: Show the owner exactly which deals will move, before applying**

```sql
select d.code, c.name,
       (select count(*) from public.deal_payments p
         where p.deal_id = d.id and p.status not in ('paid','cancelled')) as unpaid_rows,
       public.target_accounting_stage(public.deal_next_due(d.id), current_date) as will_become
  from public.deals d
  join public.pipeline_stages ps on ps.id = d.accounting_stage_id
  left join public.clients c on c.id = d.client_id
 where ps.code = 'partial_payment' and not d.archived
 order by will_become, d.code;
```

Note that deals whose earliest unpaid row is already past due will land in `on_hold`, which blocks their service cards and arms overdue reminders. Get explicit sign-off on that list before applying — this is the step where a fix becomes a surprise if skipped.

- [ ] **Step 7: Dry-run, apply, commit**

```bash
git add supabase/migrations/20260806092000_reconcile_partial_payment.sql \
        supabase/tests/reconcile_partial_payment.sql
git commit -m "fix(accounting): partial_payment deals are reconciled like every other stage"
```

---

### Task 4: One stage rule instead of two — GATED ON AN OWNER DECISION

Audit reference: A4. Two implementations of the same rule disagree on the due date itself; 7 deals hit that boundary today.

**Files:**
- Create: `supabase/migrations/20260806093000_single_stage_rule.sql`
- Create: `supabase/tests/stage_rule_boundary.sql`
- Reference: live bodies of `target_accounting_stage` and `reconcile_deal_stage`.

**Interfaces:**
- Consumes: `public.target_accounting_stage(next_due date, today date) returns text` (IMMUTABLE), and the rule inlined inside `reconcile_deal_stage`.
- Produces: `reconcile_deal_stage` calls `target_accounting_stage` instead of inlining its own copy, so there is exactly one implementation.

- [ ] **Step 1: Get the owner's decision on the boundary day**

Ask: *"When a payment is due today — not yesterday, today — should the deal be On Hold (blocking the delivery team's cards and sending an overdue notice), or Awaiting Payment (sending a 'due soon' notice)? The nightly job currently says On Hold and the payment-driven path says Awaiting Payment, so a deal can flip between them on its due date depending on which ran last."*

Recommended answer, unless the owner disagrees: **Awaiting Payment on the due date, On Hold from the day after.** A client who pays on the due date is not late, and blocking service cards on the morning of the due date is the harsher of the two readings.

Record the answer verbatim in the migration header.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/stage_rule_boundary.sql`. This test asserts that both implementations agree on all three interesting days:

```sql
-- supabase/tests/stage_rule_boundary.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(3);

-- The inlined rule inside reconcile_deal_stage must equal target_accounting_stage
-- for yesterday, today and tomorrow. Replace the expected values if the owner
-- chose the other reading in Step 1.
select is(public.target_accounting_stage(current_date - 1, current_date), 'on_hold',
          'a payment due yesterday is overdue');
select is(public.target_accounting_stage(current_date, current_date), 'awaiting_payment',
          'a payment due today is not yet overdue');
select is(public.target_accounting_stage(current_date + 1, current_date), 'awaiting_payment',
          'a payment due tomorrow is due soon');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `supabase test db --file supabase/tests/stage_rule_boundary.sql`
Expected: assertion 2 FAILS — `target_accounting_stage` currently returns `on_hold` for `next_due = today`.

- [ ] **Step 4: Write the migration**

Two changes in one file.

First, correct `target_accounting_stage` to the owner's chosen boundary:

```sql
create or replace function public.target_accounting_stage(next_due date, today date)
returns text language sql immutable set search_path to 'public' as $function$
  select case
    when next_due is null      then 'paid_in_full'
    when next_due <  today     then 'on_hold'
    when next_due <= today + 7 then 'awaiting_payment'
    else                            'paid_in_full'
  end;
$function$;
```

Second, copy the live `reconcile_deal_stage` body and replace its inlined `case` with a call, so the rule exists once:

```sql
  v_target := public.target_accounting_stage(v_next_due, current_date);
```

Everything else in `reconcile_deal_stage` — the allow-list, the `on_hold` early return, the block/unblock tail — stays byte-identical. If Task 3 has already landed, the allow-list you copy will already contain `partial_payment`; do not remove it.

Header must quote the owner's decision, name the 7 deals that were on the boundary on 2026-08-04, carry both pre-change md5s, and a `ROLLBACK:` block.

- [ ] **Step 5: Run the test and watch it pass**

Run: `supabase test db --file supabase/tests/stage_rule_boundary.sql`
Expected: 3/3 PASS.

- [ ] **Step 6: Check what moves tonight**

```sql
select d.code, ps.code as stage_now,
       public.target_accounting_stage(public.deal_next_due(d.id), current_date) as stage_after
  from public.deals d
  join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where not d.archived and d.payment_method is not null
   and ps.code in ('awaiting_payment','on_hold','paid_in_full')
   and public.target_accounting_stage(public.deal_next_due(d.id), current_date)
       is distinct from ps.code
 order by d.code;
```

Show the owner this list — it was 12 deals on 2026-08-04 — before applying.

- [ ] **Step 7: Dry-run, apply, commit**

```bash
git add supabase/migrations/20260806093000_single_stage_rule.sql \
        supabase/tests/stage_rule_boundary.sql
git commit -m "fix(accounting): one implementation of the stage rule, due-date is not overdue"
```

---

### Task 5: Stop charging VAT to cash / no-VAT deals

Audit reference: A0. **The code fix is in scope here; the refund question for the €912.31 already collected is an owner decision and is not part of this task.**

**Files:**
- Create: `supabase/migrations/20260806094000_cash_novat_payment_seeding.sql`
- Create: `supabase/tests/cash_novat_seeding.sql`
- Reference: the live bodies of `seed_deal_payments` and `generate_payments_for_deal`, and `supabase/migrations/20260720170000_vat_rate_for_country_helper.sql` for the existing VAT helper.

**Interfaces:**
- Consumes: `public.seed_deal_payments(target_deal_id uuid)` and `public.generate_payments_for_deal(target_deal_id uuid)`, plus `deals.payment_method` and `deals.cash_charge_vat`.
- Produces: both seeding paths apply a 0 `vat_rate` when the deal is cash and `cash_charge_vat` is false, matching what the deal's jobs already do.

- [ ] **Step 1: Confirm the defect and its shape**

```sql
select d.code, d.payment_method, d.cash_charge_vat,
       (select string_agg(distinct j.vat_rate::text, ',') from public.jobs j
         where j.deal_id = d.id and not j.archived) as job_rates,
       (select string_agg(distinct p.vat_rate::text, ',') from public.deal_payments p
         where p.deal_id = d.id) as payment_rates
  from public.deals d
 where d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false)
   and not d.archived
   and exists (select 1 from public.deal_payments p
                where p.deal_id = d.id and coalesce(p.vat_rate,0) > 0)
 order by d.code;
```

Expected: 11 deals, jobs at 0 and payments at 24. Record the output — it is the before-picture for the data-repair decision.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/cash_novat_seeding.sql`:

```sql
-- supabase/tests/cash_novat_seeding.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(2);

do $$
declare v_deal uuid;
begin
  select d.id into v_deal from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
   limit 1;

  update public.deals
     set payment_method = 'cash', cash_charge_vat = false,
         services_planned = jsonb_build_array(jsonb_build_object(
           'service_type','local_seo','billing_type','recurring_monthly',
           'monthly_amount',200,'one_time_amount',0,'setup_fee',0))
   where id = v_deal;

  delete from public.deal_payments where deal_id = v_deal;
  perform public.seed_deal_payments(v_deal);
  perform set_config('t.deal', v_deal::text, true);
end $$;

select is((select coalesce(max(vat_rate),-1)::text from public.deal_payments
            where deal_id = current_setting('t.deal')::uuid),
          '0.00', 'a cash no-VAT deal seeds its payments at 0% VAT');
select isnt((select count(*) from public.deal_payments
              where deal_id = current_setting('t.deal')::uuid), 0,
            'the fixture actually seeded something');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `supabase test db --file supabase/tests/cash_novat_seeding.sql`
Expected: assertion 1 FAILS with `24.00` — the seeder ignores the cash flag.

- [ ] **Step 4: Write the migration**

**`seed_deal_payments`** resolves VAT exactly once, near the top, into a local `vat numeric(5,2)`, and every one of its five `insert into public.deal_payments` statements passes that same variable. The deal record is already loaded as `d` via `select * into d from public.deals where id = target_deal_id`, so `d.payment_method` and `d.cash_charge_vat` are in scope. The whole fix is three lines immediately after the existing VAT resolution:

```sql
  select c.country into client_country from public.clients c where c.id = d.client_id;
  vat := public.vat_rate_for_country(client_country);
  -- Cash + no-VAT deals charge no VAT. The deal's JOBS already honour this flag,
  -- the payment seeders did not: 11 deals were billed 24% on top of a no-VAT
  -- agreement and EUR 912.31 was collected before this was caught (2026-08-04).
  if d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then
    vat := 0;
  end if;
```

Copy the rest of the body verbatim — the instalment split (`50_50` / `50_25_25`), the setup-fee row and the `service_index` counter all stay exactly as they are.

**`generate_payments_for_deal`** must get the equivalent guard. Read its live body first: locate where it obtains the VAT rate for the rows it creates, and apply the same `if … then vat := 0; end if;` immediately after that point, using its own variable and deal-record names. If it reads VAT per line from the job rather than per deal, gate it at the same place instead — the rule is that no row it writes may carry VAT when the deal is cash and `cash_charge_vat` is false.

Header must state the finding, the 11 affected deals, the €912.31 figure, both pre-change md5s and a `ROLLBACK:` block.

- [ ] **Step 5: Run the test and watch it pass**

Run: `supabase test db --file supabase/tests/cash_novat_seeding.sql`
Expected: 2/2 PASS.

- [ ] **Step 6: Extend the integrity alert to payments**

Both existing VAT alerts audit `jobs` only, which is why this ran undetected. In the same migration, add check 25 to `accounting_integrity_alerts`, copying the whole 24-check body from `supabase/migrations/20260805091000_service_card_not_billing_alert.sql` verbatim and appending:

```sql
    union all
    -- 25 cash_deal_payment_with_vat: the payment rows contradict the deal's
    --     no-VAT agreement. Checks 3 and 15 audit jobs only, which is how 11
    --     deals collected VAT they had agreed not to charge.
    select 'cash_deal_payment_with_vat','red','money','deal', d.id, d.code,
           'Cash no-VAT deal has VAT on its payments',
           'Deal is cash + no-VAT but '||count(*)::text||' payment row(s) carry VAT',
           d.id, null::uuid, ''
      from deals d join deal_payments p on p.deal_id = d.id
     where not d.archived and d.payment_method = 'cash'
       and not coalesce(d.cash_charge_vat, false)
       and coalesce(p.vat_rate, 0) > 0
     group by d.id, d.code
```

Note this check is a `group by` arm like check 6 — keep its column list and ordering identical to the others.

- [ ] **Step 7: Dry-run, apply, commit**

```bash
git add supabase/migrations/20260806094000_cash_novat_payment_seeding.sql \
        supabase/tests/cash_novat_seeding.sql
git commit -m "fix(vat): cash no-VAT deals seed payments at 0% and are alerted when they do not"
```

---

## Data repair runbook — owner decisions, not engineering tasks

None of these should be executed until the owner has decided each one. Each needs a backup table first, following the pattern in `docs/data-fixes/2026-08-04-deal-000403-service-change.md`.

1. **€912.31 of VAT on 11 cash/no-VAT deals** (A0) — per deal: was the cash flag set after the invoice, or is a refund/credit note owed?
2. **000173** — two paid €379.03 periods covering nearly the same month (A6). Refund, credit, or was it genuinely two months?
3. **000071 / 005523 / 000224** — under-billing by €50.80 / €41.94 / €38.71 per month (A7). Which figure is right, the job card or the payment?
4. **000415** — one €400 line attributed to one of two €200 jobs. Split it?
5. **004556 / 006095** — cancel the stale twin rows so the deals can leave `partial_payment` (A3).
6. **000041** — owes €0 in `partial_payment` since 2026-06-22. Move to `paid_in_full`?
7. **36 chains tipped by a cancelled row** (A5) — after Task 2 lands, decide whether to backfill the periods those chains missed or to start fresh from the next cycle.
