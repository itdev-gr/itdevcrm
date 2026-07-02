# Stage-Locked Accounting Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every automated accounting email fire only from its one correct accounting column, with the board move guaranteed to run before the send.

**Architecture:** One migration (`20260702140000_stage_locked_accounting_emails.sql`) rewrites `enqueue_payment_reminders()` to lock each template to a column + timing window with once-per-payment dedup, adds a `run_daily_payment_reminders()` wrapper (reconcile → enqueue) that the `daily_payment_reminders` cron is repointed to, drops the unwired `payment_due_today` template, and cancels now-out-of-scope queued reminders. The pgTAP unit test is updated first (TDD). The email-catalog HTML/PDF is regenerated to document the locked columns.

**Tech Stack:** Postgres 15 (Supabase), PL/pgSQL, pg_cron, pgTAP, Supabase MCP `apply_migration` + `execute_sql`, headless Chrome for PDF.

**Spec:** `docs/superpowers/specs/2026-07-02-stage-locked-accounting-emails-design.md`

## Global Constraints

- Prod project id: `xujlrclyzxrvxszepquy`. Apply DDL via Supabase MCP `apply_migration`; run read/verify SQL via MCP `execute_sql` (or the Management API `/database/query` with a `curl/8.x` User-Agent — plain urllib is Cloudflare-1010 blocked).
- Prod function bodies drift from `.sql` files — always capture the live body via `pg_get_functiondef` before writing a revert block; never assume the migration file matches prod.
- `deal_payments` has GENERATED columns `vat_amount` / `amount_gross` — never list them in INSERT column lists.
- `deal_payments.status` domain is `pending | paid | overdue | cancelled`. Reminder candidates are `status in ('pending','overdue')` only (excludes paid + cancelled/paused).
- `email_templates` has NO `active` column; per-email switches live in `email_automation_settings(key, enabled)` — but the payment reminders have NO row there (gated by `dept_accounting` + enqueue logic). `email_templates` DB row is the authoritative content.
- Due date = `deal_payments.start_date`. `current_date - start_date` = integer days (positive = overdue).
- Push directly to `main`, no PR. Atomic commits. Every migration ends with a commented, verbatim revert block.
- Never send to `clients.status='done'` (existing send-email chokepoint) — unchanged by this work.

---

### Task 1: Update the unit test to the stage-lock behavior (TDD — RED first)

**Files:**
- Modify/replace: `supabase/tests/enqueue_payment_reminders.sql`

**Interfaces:**
- Consumes: `public.enqueue_payment_reminders()` (returns `int` = rows enqueued), `public.email_outbox(template_key, data->>'deal_id')`.
- Produces: the behavioral contract every later task must satisfy.

- [ ] **Step 1: Replace the test file** with the stage-lock matrix below.

```sql
-- Run with: supabase test db  (transactional; rolls back)
-- Stage-locked accounting reminders — each template fires ONLY from its column:
--   payment_due_soon      -> awaiting_payment, due in (today, today+7]
--   payment_overdue       -> on_hold,          1..6 days past due
--   payment_final_notice  -> on_hold,          >=7 days past due
-- Deals in the wrong column get NO reminder.
begin;
select plan(9);

do $$
declare
  cid uuid; sales_sid uuid;
  s_await uuid; s_hold uuid; s_pif uuid; s_partial uuid;
  d_await_soon uuid;   -- awaiting + due in 3d           -> due_soon
  d_hold_over uuid;    -- on_hold  + 3d overdue          -> overdue
  d_hold_final uuid;   -- on_hold  + 9d overdue          -> final_notice
  d_await_final uuid;  -- awaiting + 7d overdue          -> NOTHING (wrong column)
  d_await_over uuid;   -- awaiting + 3d overdue          -> NOTHING (wrong column)
  d_pif uuid;          -- paid_in_full + due in 3d       -> NOTHING
  d_partial uuid;      -- partial_payment + 9d overdue   -> NOTHING
begin
  select id into sales_sid from public.pipeline_stages where board='sales' order by position limit 1;
  select id into s_await   from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment';
  select id into s_hold    from public.pipeline_stages where board='accounting_onboarding' and code='on_hold';
  select id into s_pif     from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  select id into s_partial from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment';

  insert into public.clients (name, email, country) values ('TestCo', 't@example.com', 'Greece') returning id into cid;

  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'await_soon','cash',sales_sid,s_await)   returning id into d_await_soon;
  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'hold_over','cash',sales_sid,s_hold)     returning id into d_hold_over;
  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'hold_final','cash',sales_sid,s_hold)    returning id into d_hold_final;
  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'await_final','cash',sales_sid,s_await)  returning id into d_await_final;
  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'await_over','cash',sales_sid,s_await)   returning id into d_await_over;
  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'pif','cash',sales_sid,s_pif)            returning id into d_pif;
  insert into public.deals (client_id, archived, title, payment_method, stage_id, accounting_stage_id) values
    (cid,false,'partial','cash',sales_sid,s_partial)    returning id into d_partial;

  insert into public.deal_payments
    (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status) values
    (d_await_soon, 'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending'),
    (d_hold_over,  'web_seo',0,'recurring_monthly',100,24, current_date - 3, 'overdue'),
    (d_hold_final, 'web_seo',0,'recurring_monthly',100,24, current_date - 9, 'overdue'),
    (d_await_final,'web_seo',0,'recurring_monthly',100,24, current_date - 7, 'overdue'),
    (d_await_over, 'web_seo',0,'recurring_monthly',100,24, current_date - 3, 'overdue'),
    (d_pif,        'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending'),
    (d_partial,    'web_seo',0,'recurring_monthly',100,24, current_date - 9, 'overdue'),
    -- paid row on an eligible deal must be ignored:
    (d_await_soon, 'web_seo',1,'recurring_monthly',100,24, current_date + 3, 'paid');
end $$;

-- 3 emails total: 1 due_soon + 1 overdue + 1 final_notice.
select is( public.enqueue_payment_reminders(), 3, 'exactly 3 reminders across the matrix' );
select is( (select count(*)::int from public.email_outbox where template_key='payment_due_soon'), 1, '1 due_soon (awaiting only)' );
select is( (select count(*)::int from public.email_outbox where template_key='payment_overdue'), 1, '1 overdue (on_hold only)' );
select is( (select count(*)::int from public.email_outbox where template_key='payment_final_notice'), 1, '1 final_notice (on_hold only)' );

-- KEY negative: final_notice must NOT go to the awaiting deal that is 7d overdue.
select is( (select count(*)::int from public.email_outbox o
             where o.template_key='payment_final_notice'
               and (o.data->>'deal_id')::uuid in (select id from public.deals where title='await_final')), 0,
           'no final_notice for a deal still in awaiting_payment' );

-- final_notice DOES go to the on_hold 9d-overdue deal.
select is( (select count(*)::int from public.email_outbox o
             where o.template_key='payment_final_notice'
               and (o.data->>'deal_id')::uuid in (select id from public.deals where title='hold_final')), 1,
           'final_notice for the on_hold 9d-overdue deal' );

-- No reminders for wrong-column deals (await_over, pif, partial).
select is( (select count(*)::int from public.email_outbox o
             where (o.data->>'deal_id')::uuid in
                   (select id from public.deals where title in ('await_over','pif','partial'))), 0,
           'no reminders for awaiting-overdue / paid_in_full / partial_payment deals' );

-- Idempotent second run.
select is( public.enqueue_payment_reminders(), 0, 'second run enqueues nothing (dedupe)' );

-- Rollback backup table for this change exists.
select has_table('public','email_outbox_stagelock_backup_20260702', 'stage-lock cancel backup table exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test against current prod behavior — expect FAIL (RED).**

Run (preferred, proven in this repo): submit each `do $$…$$;`-equivalent via MCP `execute_sql`, OR run `supabase test db` if a local stack is available.
Expected: FAIL. Current `enqueue_payment_reminders()` uses exact ±7/−1/−7 offsets + a broad stage whitelist, so: `due_soon` count=0 (due-in-3 not matched), `overdue` count=0 (−3 not matched), and `final_notice` lands on the *awaiting* deal (−7 + whitelist) — several assertions fail. Record which fail.

- [ ] **Step 3: Commit the (currently-failing) test.**

```bash
git add supabase/tests/enqueue_payment_reminders.sql
git commit -m "test(email): stage-locked reminder matrix (RED before migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rewrite `enqueue_payment_reminders()` — stage-locked windows

**Files:**
- Create: `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql`

**Interfaces:**
- Produces: `public.enqueue_payment_reminders() returns int` — pure (reads current stage, does NOT move deals), stage-locked per template.

- [ ] **Step 1: Capture the current live body for the revert block.** Via `execute_sql`:

```sql
select pg_get_functiondef('public.enqueue_payment_reminders()'::regprocedure);
```

Paste the output verbatim into a scratchpad file for use in Task 6 (revert). Do NOT trust the `.sql` file — use the live body.

- [ ] **Step 2: Create the migration file** with the header + new function:

```sql
-- =========================================================================
-- 20260702140000_stage_locked_accounting_emails.sql
--
-- Every automated accounting email fires ONLY from its one correct column,
-- after the nightly board move. Sections:
--   1. enqueue_payment_reminders() — stage-locked windows (this task)
--   2. run_daily_payment_reminders() wrapper + repoint cron (Task 3)
--   3. Drop payment_due_today template (Task 4)
--   4. Cancel out-of-scope queued reminders + backup (Task 5)
--   5. Revert block (Task 6, commented)
--
-- Column locks:
--   payment_due_soon      -> awaiting_payment, today < due <= today+7
--   payment_overdue       -> on_hold,          1..6 days past due
--   payment_final_notice  -> on_hold,          >=7 days past due
-- Dedup: one row per (payment_id, template) via dedupe_key.
-- =========================================================================

-- ---- Section 1: stage-locked enqueuer ----------------------------------
create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $function$
declare
  r record; tkey text; dkey text; prefix text; created int := 0; v_days_past int;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, d.code as deal_code, c.name as client_name, c.email as to_email,
           ps.code as stage_code
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
                         and d.archived = false
                         and d.suppress_payment_reminders = false
      join public.pipeline_stages ps
                        on ps.id = d.accounting_stage_id
                       and ps.board = 'accounting_onboarding'
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending','overdue')
       and c.email is not null and c.email <> ''
  loop
    v_days_past := current_date - r.due_date;   -- >0 overdue, <0 not yet due

    if r.stage_code = 'awaiting_payment'
       and r.due_date > current_date
       and r.due_date <= current_date + 7 then
      tkey := 'payment_due_soon';     prefix := 'pay_soon';
    elsif r.stage_code = 'on_hold' and v_days_past between 1 and 6 then
      tkey := 'payment_overdue';      prefix := 'pay_overdue';
    elsif r.stage_code = 'on_hold' and v_days_past >= 7 then
      tkey := 'payment_final_notice'; prefix := 'pay_final';
    else
      continue;   -- deal not in the required column / timing window: no email
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log   where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('code', r.deal_code, 'client_name', r.client_name,
                               'service_type', r.service_type, 'amount_gross', r.amount_gross,
                               'due_date', to_char(r.due_date, 'DD/MM/YYYY'), 'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $function$;
```

- [ ] **Step 3: Apply via MCP `apply_migration`** — name `stage_locked_emails_s1`, query = the file so far.

- [ ] **Step 4: Verify the new body is live.** Via `execute_sql`:

```sql
select
  pg_get_functiondef('public.enqueue_payment_reminders()'::regprocedure) ~ 'stage_code = ''awaiting_payment''' as has_awaiting_lock,
  pg_get_functiondef('public.enqueue_payment_reminders()'::regprocedure) ~ 'v_days_past between 1 and 6'        as has_overdue_window,
  pg_get_functiondef('public.enqueue_payment_reminders()'::regprocedure) ~ 'v_days_past >= 7'                   as has_final_window;
```

Expected: all `true`.

- [ ] **Step 5: Re-run the Task 1 test — the reminder assertions now pass (GREEN).** (The `has_table` assertion still fails until Task 5 — that is expected here.)

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/20260702140000_stage_locked_accounting_emails.sql
git commit -m "feat(email): stage-lock enqueue_payment_reminders to per-column windows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wrapper `run_daily_payment_reminders()` + repoint cron (move-first)

**Files:**
- Modify: `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql` (append Section 2)

**Interfaces:**
- Consumes: `public.reconcile_block_lifecycle(boolean)`, `public.enqueue_payment_reminders()`.
- Produces: `public.run_daily_payment_reminders() returns int`.

- [ ] **Step 1: Append Section 2.**

```sql

-- ---- Section 2: nightly chain (move, then send) ------------------------
create or replace function public.run_daily_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $function$
declare v_created int;
begin
  perform public.reconcile_block_lifecycle(false);          -- 1) MOVE every deal to its column
  select public.enqueue_payment_reminders() into v_created; -- 2) THEN send, stage-locked
  return v_created;
end $function$;

-- Repoint the 06:00 cron from the bare enqueuer to the chained wrapper.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'daily_payment_reminders'),
  command => 'select public.run_daily_payment_reminders();'
);
```

- [ ] **Step 2: Apply** via MCP `apply_migration` — name `stage_locked_emails_s2`, query = whole file so far.

- [ ] **Step 3: Verify** via `execute_sql`:

```sql
select command from cron.job where jobname = 'daily_payment_reminders';
```

Expected: `select public.run_daily_payment_reminders();`.

- [ ] **Step 4: Chain smoke (savepoint-rollback).** Confirms move-before-send. Via `execute_sql`:

```sql
do $$
declare v_created int;
begin
  select public.run_daily_payment_reminders() into v_created;
  raise exception 'DRY :: run_daily_payment_reminders would enqueue % now', v_created;
end $$;
```

Expected: raises `DRY :: … enqueue N now` with a small N (rolled back — nothing persists). If it errors for another reason, STOP.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/20260702140000_stage_locked_accounting_emails.sql
git commit -m "feat(email): run_daily_payment_reminders wrapper — reconcile then enqueue; repoint cron

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Drop the unwired `payment_due_today` template

**Files:**
- Modify: `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql` (append Section 3)

- [ ] **Step 1: Confirm nothing in code references it** (belt-and-suspenders):

```bash
grep -rn "payment_due_today" --include=*.ts --include=*.tsx supabase/functions src 2>/dev/null | grep -v node_modules
```

Expected: no *trigger/enqueue* reference (a bare template-list entry is fine and gets removed in Step 2 if present). If a live trigger references it, STOP and report.

- [ ] **Step 2: Append Section 3** (backup the row, then delete — reversible):

```sql

-- ---- Section 3: drop the unwired payment_due_today template ------------
-- It has no trigger and no automation-settings row (audit flag F9). Back up
-- the row, then remove it so it can never be selected.
create table if not exists public.email_templates_dropped_backup_20260702 (like public.email_templates including all);

insert into public.email_templates_dropped_backup_20260702
select * from public.email_templates where key = 'payment_due_today'
on conflict (key) do nothing;

delete from public.email_templates where key = 'payment_due_today';
```

- [ ] **Step 3: Apply** via MCP `apply_migration` — name `stage_locked_emails_s3`.

- [ ] **Step 4: Verify** via `execute_sql`:

```sql
select
  not exists (select 1 from public.email_templates where key='payment_due_today') as template_gone,
  exists (select 1 from public.email_templates_dropped_backup_20260702 where key='payment_due_today') as backed_up;
```

Expected: both `true`.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/20260702140000_stage_locked_accounting_emails.sql
git commit -m "feat(email): drop unwired payment_due_today template (audit F9)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Cancel now-out-of-scope queued reminders (+ backup table)

**Files:**
- Modify: `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql` (append Section 4)

- [ ] **Step 1: Append Section 4.**

```sql

-- ---- Section 4: cancel queued reminders now in the wrong column --------
-- Any pending/sending reminder whose deal is no longer in the column that
-- template is locked to (per Section 1) is cancelled, with a backup for revert.
create table if not exists public.email_outbox_stagelock_backup_20260702 (
  id uuid primary key,
  prior_status text not null,
  prior_last_error text,
  cancelled_at timestamptz not null default now()
);

insert into public.email_outbox_stagelock_backup_20260702 (id, prior_status, prior_last_error)
select o.id, o.status, o.last_error
  from public.email_outbox o
  left join public.deals d on d.id = (o.data->>'deal_id')::uuid
  left join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where o.status in ('pending','sending')
   and (
     (o.template_key = 'payment_due_soon'     and coalesce(ps.code,'') <> 'awaiting_payment')
  or (o.template_key = 'payment_overdue'      and coalesce(ps.code,'') <> 'on_hold')
  or (o.template_key = 'payment_final_notice' and coalesce(ps.code,'') <> 'on_hold')
   )
on conflict (id) do nothing;

update public.email_outbox
   set status = 'failed', last_error = 'cancelled by stage-lock 20260702'
 where id in (select id from public.email_outbox_stagelock_backup_20260702);
```

- [ ] **Step 2: Apply** via MCP `apply_migration` — name `stage_locked_emails_s4`.

- [ ] **Step 3: Verify** via `execute_sql`:

```sql
select
  (select count(*) from public.email_outbox_stagelock_backup_20260702) as cancelled_count,
  not exists (
    select 1 from public.email_outbox o
    left join public.deals d on d.id = (o.data->>'deal_id')::uuid
    left join public.pipeline_stages ps on ps.id = d.accounting_stage_id
    where o.status in ('pending','sending')
      and ( (o.template_key='payment_due_soon'     and coalesce(ps.code,'')<>'awaiting_payment')
         or (o.template_key='payment_overdue'      and coalesce(ps.code,'')<>'on_hold')
         or (o.template_key='payment_final_notice' and coalesce(ps.code,'')<>'on_hold') )
  ) as no_wrong_column_pending;
```

Expected: `no_wrong_column_pending = true` (cancelled_count is whatever was live; often 0 since the outbox is usually drained).

- [ ] **Step 4: Re-run the Task 1 test in full — all 9 assertions PASS (GREEN),** including `has_table('…stagelock_backup_20260702')`.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/20260702140000_stage_locked_accounting_emails.sql
git commit -m "feat(email): cancel out-of-scope queued reminders on stage-lock (with backup)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Append the revert block

**Files:**
- Modify: `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql` (append Section 5)

- [ ] **Step 1: Append Section 5** — a commented block containing, in order:
  1. The verbatim pre-change `enqueue_payment_reminders()` body captured in Task 2 Step 1 (`create or replace …`).
  2. `select cron.alter_job((select jobid from cron.job where jobname='daily_payment_reminders'), command => 'select public.enqueue_payment_reminders();');`
  3. `drop function if exists public.run_daily_payment_reminders();`
  4. `insert into public.email_templates select * from public.email_templates_dropped_backup_20260702 where key='payment_due_today' on conflict (key) do nothing;`
  5. Restore cancelled outbox rows:
     `update public.email_outbox o set status=b.prior_status, last_error=b.prior_last_error from public.email_outbox_stagelock_backup_20260702 b where o.id=b.id and o.status='failed' and o.last_error='cancelled by stage-lock 20260702';`
  6. `drop table if exists public.email_outbox_stagelock_backup_20260702;` and `drop table if exists public.email_templates_dropped_backup_20260702;`

  Every line prefixed with `--`, matching the migration convention.

- [ ] **Step 2: Commit.**

```bash
git add supabase/migrations/20260702140000_stage_locked_accounting_emails.sql
git commit -m "docs(email): append verbatim revert SQL for stage-lock migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update the email catalog (HTML + regenerate PDF)

**Files:**
- Modify: `docs/system-analysis/2026-07-02-email-catalog.html`
- Regenerate: `docs/system-analysis/2026-07-02-email-catalog.pdf`

- [ ] **Step 1: Edit the HTML.** In the three reminder cards, change the `Trigger` line to state the locked column, e.g.:
  - `payment_due_soon`: "Στέλνεται μόνο όταν το deal είναι στη στήλη **Awaiting Payment** και η πληρωμή λήγει εντός 7 ημερών (μία φορά ανά πληρωμή, μετά τη νυχτερινή μετακίνηση)."
  - `payment_overdue`: "Στέλνεται μόνο όταν το deal είναι **On Hold** και η πληρωμή είναι 1–6 ημέρες εκπρόθεσμη."
  - `payment_final_notice`: "Στέλνεται μόνο όταν το deal είναι **On Hold** και η πληρωμή είναι ≥7 ημέρες εκπρόθεσμη."
  Remove the `payment_due_today` card (or mark it «Καταργήθηκε 2026-07-02»). Add to the intro `<ul>`: "Κάθε αυτόματο λογιστικό email στέλνεται μόνο από την αντίστοιχη στήλη του πίνακα, αφού πρώτα γίνει η νυχτερινή μετακίνηση." Update the header count (24 emails).

- [ ] **Step 2: Regenerate the PDF** via headless Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --print-to-pdf="/Users/marios/Desktop/Cursor/itdevcrm/docs/system-analysis/2026-07-02-email-catalog.pdf" \
  --no-pdf-header-footer \
  "file:///Users/marios/Desktop/Cursor/itdevcrm/docs/system-analysis/2026-07-02-email-catalog.html"
```

Expected: PDF rewritten (non-zero size, newer mtime).

- [ ] **Step 3: Verify** the PDF opens and shows the locked columns:

```bash
open "/Users/marios/Desktop/Cursor/itdevcrm/docs/system-analysis/2026-07-02-email-catalog.pdf"
```

- [ ] **Step 4: Commit.**

```bash
git add docs/system-analysis/2026-07-02-email-catalog.html docs/system-analysis/2026-07-02-email-catalog.pdf
git commit -m "docs(email): catalog shows per-column lock for accounting reminders; drop due_today

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Final regression + live dry-run + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full Task 1 test** (`supabase test db` or the MCP equivalent). Expected: 9/9 PASS.

- [ ] **Step 2: Live dry-run of the whole chain (savepoint-rollback).** Via `execute_sql`:

```sql
do $$
declare v_created int; v_soon int; v_over int; v_final int;
begin
  perform public.reconcile_block_lifecycle(false);
  select public.enqueue_payment_reminders() into v_created;
  select count(*) into v_soon  from public.email_outbox where template_key='payment_due_soon'     and status='pending';
  select count(*) into v_over  from public.email_outbox where template_key='payment_overdue'      and status='pending';
  select count(*) into v_final from public.email_outbox where template_key='payment_final_notice' and status='pending';
  raise exception 'DRY :: would_enqueue=% (soon +% over +% final +%) — includes pre-existing pending', v_created, v_soon, v_over, v_final;
end $$;
```

Expected: raises with a sane `would_enqueue` count (rolled back). Sanity-check the split looks reasonable vs the current board (awaiting=~46, on_hold=~49).

- [ ] **Step 3: Confirm no regression to the payments state machine** — run the flip-fix/full-smoke harnesses' cron-touching scenarios (or at minimum re-run the Task 1 test) and confirm no new failures. (These functions were not modified; this is a safety net.)

- [ ] **Step 4: Push all commits.**

```bash
git push origin main
```

- [ ] **Step 5: Update memory** — add to `reference_accounting_verification_20260702.md` (or a new `project_stage_locked_emails.md`) that accounting emails are now per-column locked (due_soon→awaiting, overdue/final→on_hold), the nightly cron chains reconcile→enqueue, payment_due_today dropped, migration `20260702140000`, catalog PDF updated. Add a one-line MEMORY.md index entry.

---

## Self-Review

**1. Spec coverage:**
- Nightly chain (move→send): Task 3 (`run_daily_payment_reminders` + cron repoint) + Task 8 dry-run.
- Per-email stage lock (windows): Task 2 function + Task 1 tests (positive + negative).
- Drop payment_due_today: Task 4.
- Cancel out-of-scope queued rows + backup: Task 5.
- won_welcome / contract_send untouched: not modified (no task) — correct.
- Catalog HTML + PDF: Task 7.
- Tests (positive + "wrong column → silent" + dedup + chain): Task 1 + Task 8.
- Rollback SQL: Task 6.

**2. Placeholder scan:** No TBD/TODO. Every SQL block and the pgTAP test are complete. Revert (Task 6) references the live body captured in Task 2 Step 1 (explicitly instructed to capture, not assumed).

**3. Type consistency:**
- `enqueue_payment_reminders() → int`, `run_daily_payment_reminders() → int`, `reconcile_block_lifecycle(boolean) → int` — consistent across tasks.
- Template keys `payment_due_soon` / `payment_overdue` / `payment_final_notice` and prefixes `pay_soon` / `pay_overdue` / `pay_final` consistent between the function (Task 2) and the tests (Task 1).
- Backup tables `email_outbox_stagelock_backup_20260702` and `email_templates_dropped_backup_20260702` named identically in create/verify/revert and in the test's `has_table` assertion.
- Column lock windows identical in Section 1 (function), Section 4 (cancel), and the Task 1 assertions.
