# Same-Day Payment-Reminder Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One aggregated reminder email per (deal, template, due date) instead of one per payment row.

**Architecture:** Single `CREATE OR REPLACE` of `enqueue_payment_reminders()` — classification stays byte-identical to the live body (`20260702140000` Section 1); a grouping layer sums same-day amounts and swaps the dedupe key to `<prefix>:<deal_id>:<YYYYMMDD>`, with a legacy per-payment-key exclusion for the transition. Spec: `docs/superpowers/specs/2026-07-29-same-day-reminder-aggregate-design.md`.

**Tech Stack:** plpgsql migration + the RAISE-style prod SQL harness (`supabase/tests/`).

## Global Constraints

- The harness file runs against PROD (rolled back); do NOT execute it in these tasks — apply/verify happens in the main session with the owner's token.
- Classification predicates, joins and guards must stay VERBATIM from `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql` lines 26–56 — this change may alter only how classified rows are grouped/keyed/emitted.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Push to `main` directly, no PRs.

---

### Task 1: Aggregation migration

**Files:**
- Create: `supabase/migrations/20260729100000_payment_reminders_same_day_aggregate.sql`

**Interfaces:**
- Produces: new `enqueue_payment_reminders()` body; group dedupe key format `<prefix>:<deal_id>:<YYYYMMDD>`. `run_daily_payment_reminders()` wrapper and cron are untouched.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260729100000_payment_reminders_same_day_aggregate.sql`:

```sql
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
```

- [ ] **Step 2: Verify by reading**

No local DB. Check, against `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql`:
- the `cand` CTE's joins/WHERE and the three CASE windows express the same predicates as the live loop (lines 26–56 there);
- the outbox INSERT's `jsonb_build_object` keys are identical;
- the REVERT block matches that file's Section 1 byte-for-byte in logic.
Confirm the loop record `r` only references columns the grouped SELECT emits.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729100000_payment_reminders_same_day_aggregate.sql
git commit -m "feat(email): aggregate same-day payment reminders per deal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Harness scenarios

**Files:**
- Modify: `supabase/tests/enqueue_payment_reminders.sql` (append after SL14)

**Interfaces:**
- Consumes: the group dedupe key format `<prefix>:<deal_id>:<YYYYMMDD>` from Task 1.

- [ ] **Step 1: Append the three scenarios**

Append to `supabase/tests/enqueue_payment_reminders.sql`:

```sql
-- ---- SL15 (AGGREGATE): two pending payments due SAME day -> ONE summed email
do $$
declare v_client uuid; v_deal uuid; v_rows int; v_amount numeric; v_key text; v_rows2 int;
begin
  insert into public.clients (name, email, country) values ('sl15_'||gen_random_uuid()::text,'sl15@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL15','sl15','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending'),
           (v_deal,'hosting',1,'recurring_monthly',200,24, current_date + 3, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*) into v_rows from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  select (data->>'amount_gross')::numeric, dedupe_key into v_amount, v_key
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal limit 1;
  perform public.enqueue_payment_reminders();   -- re-run: group key must dedupe
  select count(*) into v_rows2 from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_rows <> 1 or v_rows2 <> 1 or v_amount <> 372.00
     or v_key <> 'pay_soon:'||v_deal||':'||to_char(current_date+3,'YYYYMMDD') then
    raise exception 'RESULT :: FAIL SL15 :: expected 1 summed row (372.00, group key), got rows=% rows2=% amount=% key=%', v_rows, v_rows2, v_amount, v_key;
  end if;
  raise exception 'RESULT :: PASS SL15 :: two same-day payments -> 1 summed due_soon (372.00), re-run dedupes';
end $$;

-- ---- SL16 (AGGREGATE scope): two payments due DIFFERENT days -> two emails
do $$
declare v_client uuid; v_deal uuid; v_rows int; v_dates int;
begin
  insert into public.clients (name, email, country) values ('sl16_'||gen_random_uuid()::text,'sl16@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL16','sl16','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending'),
           (v_deal,'web_seo',1,'recurring_monthly',100,24, current_date + 5, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*), count(distinct data->>'due_date') into v_rows, v_dates
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_due_soon';
  if v_rows <> 2 or v_dates <> 2 then
    raise exception 'RESULT :: FAIL SL16 :: different due dates must email separately, got rows=% dates=%', v_rows, v_dates;
  end if;
  raise exception 'RESULT :: PASS SL16 :: different-day payments -> 2 separate due_soon emails';
end $$;

-- ---- SL17 (TRANSITION): payment already reminded under legacy key -> only the other aggregates
do $$
declare v_client uuid; v_deal uuid; v_paid uuid; v_rows int; v_amount numeric;
begin
  insert into public.clients (name, email, country) values ('sl17_'||gen_random_uuid()::text,'sl17@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL17','sl17','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending')
    returning id into v_paid;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'hosting',1,'recurring_monthly',200,24, current_date + 3, 'pending');
  -- Simulate the pre-aggregation era: first payment already reminded.
  insert into public.email_log (identity, to_email, template_key, status, dedupe_key)
    values ('accounting','sl17@example.com','payment_due_soon','sent','pay_soon:'||v_paid);
  perform public.enqueue_payment_reminders();
  select count(*) into v_rows from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  select (data->>'amount_gross')::numeric into v_amount
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal limit 1;
  if v_rows <> 1 or v_amount <> 248.00 then
    raise exception 'RESULT :: FAIL SL17 :: expected 1 row covering only the un-reminded payment (248.00), got rows=% amount=%', v_rows, v_amount;
  end if;
  raise exception 'RESULT :: PASS SL17 :: legacy-reminded payment excluded; other aggregates alone (248.00)';
end $$;
```

- [ ] **Step 2: Verify by reading**

Do NOT run the harness (prod). Check: seeds mirror SL1's column set exactly (plus `created_at` omitted for pending future-dated rows, as SL1 does); the amounts assert the GENERATED `amount_gross` (net × 1.24): 124.00 + 248.00 = 372.00; SL17's `email_log` insert uses only columns SL-harness-visible (`identity, to_email, template_key, status, dedupe_key`).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/enqueue_payment_reminders.sql
git commit -m "test(email): harness scenarios for same-day reminder aggregation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Apply + verify (main session — needs owner token)

- [ ] Push to `main`.
- [ ] Drift check: `select pg_get_functiondef('public.enqueue_payment_reminders'::regproc)` — diff against `20260702140000` Section 1; investigate any drift before replacing.
- [ ] Apply `20260729100000_payment_reminders_same_day_aggregate.sql`.
- [ ] Run the harness (SL1–SL17) via runharness.py / Mgmt API; expect 17 PASS.
- [ ] Next 06:00 run (or a seeded dry check): a deal with two same-day dues produces ONE outbox row.
- [ ] Update memory (`project_stage_locked_emails` or successor) with the aggregation + key-format change.
```
