# Payment System Full Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete, evidence-backed bug report on the CRM payment system — every payment method, every reminder, every cron in the money path — ranked by money impact, with each claim verified against live prod data AND the current code before it is called a bug.

**Architecture:** Read-only audit. Each task probes one subsystem with exact SQL against prod (Supabase Management API) plus a code read of the governing function, records findings in a shared findings file, and attempts to refute each finding before accepting it. A final synthesis task merges everything into `docs/system-analysis/2026-08-26-payment-system-audit.md`, cross-referenced against the 2026-08-04 audit (what is still open, regressed, fixed, or new).

**Tech Stack:** Node scratchpad scripts → Supabase Management API `POST /v1/projects/xujlrclyzxrvxszepquy/database/query` (token `scratchpad/sbp.token`, header `User-Agent: supabase-cli/2.30.4`); repo migrations under `supabase/migrations/`; docs under `docs/tech/accounting/`.

## Global Constraints

- **READ-ONLY on prod.** Every query in this plan is a SELECT. No UPDATE/INSERT/DELETE/DDL anywhere, no matter what is found. Fixes are a separate plan after the owner reads the report.
- Management API statement timeout is ~8s — keep queries indexed/aggregated; never full-scan comments or email_log without a date bound.
- Findings accumulate in `scratchpad/audit-findings.md` (one `## F<N>` block each: claim, evidence query + result, refutation attempt, verdict CONFIRMED/REFUTED/NEEDS-OWNER). The synthesis task consumes this file.
- **Read before re-deriving:** `docs/system-analysis/2026-08-04-accounting-full-audit.md` and `docs/superpowers/plans/2026-08-04-accounting-critical-fixes.md` are the prior audit; memory note `accounting-audit-open-findings` summarizes what is open (A0 cash-VAT €912.31, A2 partial_payment trap, A4 stage boundary, A5 cancelled-topped chains, A6 overlaps, A7 price drift, A7b/A8) and what was verified clean on 2026-08-06. Re-measure open items (20 days stale); do not re-hunt the verified-clean list unless a probe contradicts it.
- **A7 caveat carried forward:** never quote per-job price-drift sums as money owed — grouped billing (000415) and service swaps (000406) are known measurement artifacts; any drift claim needs a per-deal look.
- Live facts captured at planning time (2026-08-26): payment methods in use `online` 553 / `cash` 58 deals; `deal_payments` statuses paid 883 / overdue 113 / cancelled 93 / pending 87; reminder sends to date: due_soon 388, overdue 379, final_notice 141 (all three fired again this morning); cron `daily_move_overdue_deals_to_on_hold` is **inactive** — every other money cron active.

---

### Task 1: Baseline snapshot + drift check (does prod code match the repo?)

**Files:**
- Create: `scratchpad/audit-01-baseline.mjs`
- Read: `docs/system-analysis/2026-08-04-accounting-full-audit.md`, `docs/tech/accounting/billing-model.md`, `docs/tech/accounting/payment-reminders.md`, `docs/tech/accounting/block-lifecycle.md`, `docs/tech/accounting/deal-lifecycle.md`, `docs/tech/accounting/renewal-close.md`

**Interfaces:**
- Produces: `scratchpad/audit-findings.md` (created with a `# Findings` header and the baseline tables); `scratchpad/audit-baseline.json` (counts every later task compares against).

- [ ] **Step 1: Read the five accounting docs + the 2026-08-04 audit end-to-end.** List in the findings file every documented invariant the docs promise (e.g. "reminders key off start_date", "status CHECK is pending/paid/overdue", "mark_overdue runs before reminders").

- [ ] **Step 2: Snapshot the live system.** Run in `audit-01-baseline.mjs`:

```sql
-- 1a. counts by method/status/stage
select d.payment_method, dp.status, count(*), sum(dp.amount_net)::numeric(12,2) as net
from public.deal_payments dp join public.deals d on d.id = dp.deal_id
group by 1,2 order by 1,2;
-- 1b. accounting stage distribution
select s.code, count(*) from public.deals d join public.pipeline_stages s on s.id = d.stage_id
where s.board = 'accounting' group by 1 order by 2 desc;
-- 1c. cron health: last 3 runs of every money cron
select j.jobname, r.status, r.return_message, r.end_time
from cron.job j join lateral (
  select status, return_message, end_time from cron.job_run_details d
  where d.jobid = j.jobid order by end_time desc limit 3) r on true
where j.jobname in ('daily_ensure_recurring_payments','mark-overdue-payments','daily_payment_reminders',
  'reconcile_block_lifecycle','reconcile_seo_renewal','reconcile_payment_integrity','drain_email_outbox')
order by j.jobname, r.end_time desc;
-- 1d. the CHECK constraint the docs claim excludes 'cancelled' (93 cancelled rows exist!)
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.deal_payments'::regclass and contype = 'c';
```

- [ ] **Step 3: Drift check — md5 the live money functions.**

```sql
select proname, md5(pg_get_functiondef(oid)) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in (
  'ensure_recurring_payments','mark_overdue_payments','enqueue_payment_reminders',
  'reconcile_deal_stage','reconcile_block_lifecycle','target_accounting_stage',
  'recompute_job_period_dates','seed_deal_payments','release_billing_jobs_for_deal',
  'release_jobs_for_deal','seed_deal_jobs_and_payments')
order by proname;
```

Then grep each function's latest definition in `supabase/migrations/` (`grep -rln "create or replace function public.<name>" supabase/migrations | sort | tail -1`) and compare shape (not md5 — migrations drift cosmetically): flag any live function whose latest repo migration clearly differs in logic. Record per-function verdict in findings.

- [ ] **Step 4: Record baseline + doc-vs-live contradictions as findings.** Known candidate from planning: docs say `deal_payments.status` CHECK is `('pending','paid','overdue')` but 93 `cancelled` rows exist — record what the live CHECK actually allows and whether docs or DB is wrong.

- [ ] **Step 5: Commit** (scratchpad is not in the repo — commit only if any tracked doc got corrected; otherwise no commit for this task).

---

### Task 2: Payment methods & VAT correctness (online / cash / cash_charge_vat / Cyprus)

**Files:**
- Create: `scratchpad/audit-02-vat.mjs`
- Read: `supabase/migrations/20260702160000_cash_charge_vat.sql`, `supabase/migrations/20260713150000_jobs_per_type_billing.sql:44-56` (the VAT derivation)

**Interfaces:**
- Consumes: `audit-baseline.json` counts.
- Produces: findings F-blocks tagged `[VAT]`.

- [ ] **Step 1: Re-measure A0 (cash deals charged VAT).** The 2026-08-06 figure was 11 deals / 19 rows / €912.31:

```sql
select d.code, d.payment_method, d.cash_charge_vat, count(*) as rows_at_24,
       sum(dp.amount_net * dp.vat_rate/100)::numeric(12,2) as vat_collected
from public.deal_payments dp join public.deals d on d.id = dp.deal_id
where d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false)
  and dp.vat_rate > 0 and dp.status = 'paid'
group by 1,2,3 order by 5 desc;
```

- [ ] **Step 2: The mirror bug — online deals with 0% VAT rows** (money under-collected, only Cyprus clients are legitimately 0%):

```sql
select d.code, c.country, dp.status, count(*), sum(dp.amount_net)::numeric(12,2)
from public.deal_payments dp
join public.deals d on d.id = dp.deal_id join public.clients c on c.id = d.client_id
where d.payment_method = 'online' and dp.vat_rate = 0
  and trim(coalesce(c.country,'')) not ilike 'cyprus'
group by 1,2,3 order by 5 desc limit 30;
```

- [ ] **Step 3: jobs-vs-payments VAT disagreement** (the blind spot that hid A0 — alerts audit jobs only):

```sql
select d.code, j.code as job_code, j.vat_rate as job_vat, dp.vat_rate as pay_vat, dp.status
from public.jobs j
join public.deals d on d.id = j.deal_id
join public.deal_payments dp on dp.deal_id = j.deal_id
  and dp.service_type = j.service_type and dp.billing_type = j.billing_type
where not j.archived and j.vat_rate is distinct from dp.vat_rate
  and dp.status in ('paid','pending','overdue')
order by d.code limit 40;
```

- [ ] **Step 4: Method-change consistency.** Deals whose `payment_method` changed after seeding keep old VAT on unpaid rows — find unpaid rows whose vat disagrees with what the deal's method/country dictates today:

```sql
select d.code, d.payment_method, d.cash_charge_vat, c.country, dp.status, dp.vat_rate, dp.start_date
from public.deal_payments dp
join public.deals d on d.id = dp.deal_id join public.clients c on c.id = d.client_id
where dp.status in ('pending','overdue')
  and dp.vat_rate is distinct from (case
    when d.payment_method='cash' and not coalesce(d.cash_charge_vat,false) then 0.00
    when trim(coalesce(c.country,'')) ilike 'cyprus' then 0.00 else 24.00 end)
order by d.code;
```

- [ ] **Step 5: Refute-or-confirm each hit** (open the deal's payment history for the top offenders; a legitimate mid-life VAT change — e.g. client moved to invoice-less cash by owner decision — is not a bug). Record verdicts.

---

### Task 3: Recurring renewal generator (`ensure_recurring_payments` cron 02:00)

**Files:**
- Create: `scratchpad/audit-03-renewals.mjs`
- Read: the latest migration defining `ensure_recurring_payments` (locate: `grep -rln "ensure_recurring_payments" supabase/migrations | sort | tail -3`), `docs/tech/accounting/renewal-close.md`

**Interfaces:**
- Produces: findings tagged `[RENEWAL]`, including re-measured A5/A6/A7.

- [ ] **Step 1: Read the live generator body** (`select pg_get_functiondef(oid)`) and note: does it skip `cancelled` heads (A5)? does it copy the previous amount (A7)? what stops generation (deal stage? job archived? billing_active?).

- [ ] **Step 2: Re-measure A5 — chains topped by a cancelled row** (was 47/410 and growing):

```sql
with heads as (
  select distinct on (dp.deal_id, dp.service_type, dp.billing_type)
         dp.deal_id, dp.service_type, dp.billing_type, dp.status, dp.end_date
  from public.deal_payments dp where dp.billing_type like 'recurring%'
  order by dp.deal_id, dp.service_type, dp.billing_type, dp.end_date desc)
select status, count(*) from heads group by 1;
```

- [ ] **Step 3: Gap scan — active recurring jobs whose chain stopped renewing** (billing silently dead; the class A1 fixed one cause of):

```sql
select d.code, j.service_type, j.billing_type, max(dp.end_date) as chain_end, s.code as deal_stage
from public.jobs j
join public.deals d on d.id = j.deal_id
left join public.pipeline_stages s on s.id = d.stage_id
left join public.deal_payments dp on dp.deal_id = j.deal_id
  and dp.service_type = j.service_type and dp.billing_type = j.billing_type and dp.status <> 'cancelled'
where not j.archived and j.billing_active and j.billing_type like 'recurring%'
group by 1,2,3,5
having max(dp.end_date) < current_date - 7 or max(dp.end_date) is null
order by chain_end nulls first limit 40;
```

- [ ] **Step 4: Re-measure A6 — overlapping paid periods** (was 4 pairs):

```sql
select a.deal_id, a.service_type, a.start_date, a.end_date, b.start_date, b.end_date
from public.deal_payments a join public.deal_payments b
  on b.deal_id = a.deal_id and b.service_type = a.service_type and b.billing_type = a.billing_type
 and b.id > a.id and a.status='paid' and b.status='paid'
 and a.start_date < b.end_date and b.start_date < a.end_date;
```

- [ ] **Step 5: Re-measure A7 — job price vs last billed amount** (per-deal listing, apply the grouped-billing caveat before calling any row a bug):

```sql
select d.code, j.code as job_code, j.monthly_amount, dp.amount_net, dp.start_date
from public.jobs j
join public.deals d on d.id = j.deal_id
join lateral (select amount_net, start_date from public.deal_payments p
  where p.deal_id=j.deal_id and p.service_type=j.service_type and p.billing_type=j.billing_type
    and p.status <> 'cancelled' order by end_date desc limit 1) dp on true
where not j.archived and j.billing_active and j.billing_type='recurring_monthly'
  and j.monthly_amount is not null and j.monthly_amount <> dp.amount_net
order by abs(j.monthly_amount - dp.amount_net) desc limit 40;
```

- [ ] **Step 6: Future-dated & duplicate-pending sanity:** pending rows starting >13 months out (domains excluded), and >1 non-cancelled pending/overdue rows for the same (deal, service, billing, start_date). Record verdicts for every step.

---

### Task 4: Status transitions (`mark_overdue_payments`, cancellations, paid hygiene)

**Files:**
- Create: `scratchpad/audit-04-status.mjs`
- Read: `supabase/migrations/20260610000004_money_seeding_and_overdue.sql`

**Interfaces:**
- Produces: findings tagged `[STATUS]`.

- [ ] **Step 1: Rows that should be overdue but aren't** (cron gap — `mark_overdue` flips on `end_date < current_date`; docs also promise it runs before reminders):

```sql
select count(*), min(end_date) from public.deal_payments
where status = 'pending' and end_date < current_date;
```

- [ ] **Step 2: Rows overdue that shouldn't be** (`end_date >= today` yet status overdue — stale flips never un-flip?):

```sql
select count(*), max(end_date) from public.deal_payments
where status = 'overdue' and end_date >= current_date;
```

- [ ] **Step 3: Paid-row hygiene:** paid with null/inverted dates, paid with amount_net <= 0, paid rows on archived deals:

```sql
select 'null_dates' k, count(*) from public.deal_payments where status='paid' and (start_date is null or end_date is null)
union all select 'inverted', count(*) from public.deal_payments where status='paid' and end_date < start_date
union all select 'nonpositive', count(*) from public.deal_payments where status='paid' and amount_net <= 0
union all select 'archived_deal', count(*) from public.deal_payments dp join public.deals d on d.id=dp.deal_id
  where dp.status in ('pending','overdue') and d.archived;
```

- [ ] **Step 4: Cancelled semantics:** who sets `cancelled`, and does anything downstream (reminders, renewal generator, stage reconcile, Due-date recompute) treat it correctly? Grep migrations for `'cancelled'` and list every consumer with its behavior; cross-check each against the live counts. (Known: `recompute_job_period_dates` ignores status entirely except paid — feeds the paused Due-date fix.)

- [ ] **Step 5: Record verdicts.**

---

### Task 5: Payment reminders end-to-end (−7 / +1 / +7, dedupe, suppression, delivery)

**Files:**
- Create: `scratchpad/audit-05-reminders.mjs`
- Read: `supabase/migrations/20260616000004_payment_reminder_sequence.sql`, `20260626000000_deals_suppress_payment_reminders.sql`, `20260626000004_payment_reminder_subject_code.sql`, `docs/tech/accounting/payment-reminders.md`

**Interfaces:**
- Produces: findings tagged `[REMINDER]`.

- [ ] **Step 1: Live function vs doc.** `pg_get_functiondef('public.enqueue_payment_reminders'::regproc)` — verify windows are exactly `start_date IN (today+7, today−1, today−7)`, statuses `('pending','overdue')`, suppression + archived + client-email guards present, dedupe key `prefix:payment_id`.

- [ ] **Step 2: Missed-fire audit — payments that crossed a window but never got that reminder** (last 60 days; the strongest reminder bug detector):

```sql
select w.prefix, count(*) as missed
from public.deal_payments dp
join public.deals d on d.id = dp.deal_id
join public.clients c on c.id = d.client_id
cross join (values ('pay_soon', 7), ('pay_overdue', -1), ('pay_final', -7)) as w(prefix, off)
where dp.status in ('pending','overdue')
  and dp.start_date - w.off between current_date - 60 and current_date - 1
  and not d.archived and not coalesce(d.suppress_payment_reminders, false)
  and coalesce(c.email,'') <> ''
  and not exists (select 1 from public.email_log el
    where el.dedupe_key = w.prefix || ':' || dp.id)
  and not exists (select 1 from public.email_outbox eo
    where eo.dedupe_key = w.prefix || ':' || dp.id)
group by 1;
```

For any misses: pull 5 examples and figure out which guard ate them (was the row still `pending` on the fire date? created after the window passed? cron down that day — check `cron.job_run_details` for 06:00 failures).

- [ ] **Step 3: Wrong-fire audit:** reminders sent for paid/cancelled payments (status flipped before send but after enqueue?), reminders on suppressed/archived deals, duplicate sends per dedupe key:

```sql
select el.template_key, dp.status, count(*)
from public.email_log el
join public.deal_payments dp on el.dedupe_key like '%:' || dp.id
where el.template_key in ('payment_due_soon','payment_overdue','payment_final_notice')
group by 1,2 order by 1,2;
select dedupe_key, count(*) from public.email_log
where template_key in ('payment_due_soon','payment_overdue','payment_final_notice')
group by 1 having count(*) > 1 limit 20;
```

- [ ] **Step 4: Delivery health:** of reminders sent last 30 days, how many bounced/complained (`email_log.status`), and are we still reminding addresses that hard-bounced before (repeat sends to a bounced address = a bug worth flagging):

```sql
select status, count(*) from public.email_log
where template_key like 'payment_%' and created_at > now() - interval '30 days' group by 1;
select to_email, count(*) filter (where status='bounced') as bounces, max(created_at)::date
from public.email_log where template_key like 'payment_%'
group by 1 having count(*) filter (where status='bounced') > 0
   and max(created_at) > now() - interval '30 days' order by 2 desc limit 20;
```

- [ ] **Step 5: Template render check:** read the three `email_templates` rows (subject/body) and verify every `{{var}}` used is supplied by the enqueuer's data payload (code, client_name, service_type, amount_gross, due_date) — a renamed variable renders blank silently. Also confirm `payment_due_today` really never enqueues (last log row 2026-06-24, template row still present).

- [ ] **Step 6: Suppression coverage:** list deals with `suppress_payment_reminders = true` + their unpaid balance — flag any with large overdue sums the owner may not realize are muted. Record verdicts.

---

### Task 6: Deal stage & block lifecycle (awaiting_payment / on_hold / partial_payment / paid_in_full)

**Files:**
- Create: `scratchpad/audit-06-lifecycle.mjs`
- Read: `docs/tech/accounting/block-lifecycle.md`, `docs/tech/accounting/deal-lifecycle.md`, live defs of `reconcile_deal_stage`, `reconcile_block_lifecycle`, `target_accounting_stage`

**Interfaces:**
- Produces: findings tagged `[LIFECYCLE]`, re-measured A2/A4.

- [ ] **Step 1: Re-measure A2 — deals stuck in `partial_payment`** (was 18, 12 with recurring services; list each with balance owed and whether €0-owed cases now exist).

- [ ] **Step 2: Re-measure A4 — the `<=` vs `<` boundary:** deals whose next due is exactly today, and which stage each implementation would put them in; confirm the two functions still disagree.

- [ ] **Step 3: Stage-vs-money mismatch sweep:** deals on `paid_in_full` with pending/overdue rows; deals on `awaiting_payment`/`on_hold` owing €0; archived deals with unpaid rows:

```sql
select s.code as stage, count(*) filter (where owed > 0) as owing, count(*) filter (where owed = 0) as clear
from (select d.id, d.stage_id, coalesce(sum(dp.amount_net) filter (where dp.status in ('pending','overdue')),0) as owed
      from public.deals d left join public.deal_payments dp on dp.deal_id = d.id
      where not d.archived group by 1,2) x
join public.pipeline_stages s on s.id = x.stage_id where s.board='accounting'
group by 1 order by 1;
```

- [ ] **Step 4: The inactive cron.** `daily_move_overdue_deals_to_on_hold` is disabled — establish from migrations whether `reconcile_block_lifecycle` (02:20, active) fully superseded it, or whether some transition now happens never. Record which migration disabled it and why (grep migration comments).

- [ ] **Step 5: `reconcile_payment_integrity` (04:00) — read its body and its alert sink; list currently-open integrity alerts and whether any point at payment bugs already known/new:

```sql
select alert_type, count(*), max(created_at)::date from public.integrity_alerts
where resolved_at is null group by 1 order by 2 desc;
```

(Adjust table/column names to what the live schema actually has — discover with `\d`-equivalent information_schema query first.) Record verdicts.

---

### Task 7: Money-path integrations (lines, ledger, won-push, outbox drain)

**Files:**
- Create: `scratchpad/audit-07-integrations.mjs`
- Read: `supabase/functions/push-won-sale/index.ts`, `docs/tech/accounting/billing-model.md` (ledger section), latest `seed_deal_payments` migration

**Interfaces:**
- Produces: findings tagged `[INTEGRATION]`.

- [ ] **Step 1: `deal_payment_lines` referential hygiene:** lines pointing at archived jobs, lines whose job belongs to a different deal than the payment, payments with lines summing ≠ payment amount, non-cancelled payments with zero lines:

```sql
select 'line_to_archived_job' k, count(*) from public.deal_payment_lines l join public.jobs j on j.id=l.job_id where j.archived
union all select 'line_cross_deal', count(*) from public.deal_payment_lines l
  join public.deal_payments p on p.id=l.payment_id join public.jobs j on j.id=l.job_id where j.deal_id <> p.deal_id
union all select 'lines_sum_mismatch', count(*) from (
  select l.payment_id from public.deal_payment_lines l join public.deal_payments p on p.id=l.payment_id
  group by l.payment_id, p.amount_net having sum(l.amount_net) <> p.amount_net) z
union all select 'paid_no_lines', count(*) from public.deal_payments p
  where p.status='paid' and not exists (select 1 from public.deal_payment_lines l where l.payment_id=p.id);
```

- [ ] **Step 2: Ledger mutability & month attribution (A8):** check whether ledger rows (locate table via information_schema, likely `ledger_entries` / revenue view) can drift from `deal_payments` — count paid payments modified after their ledger month closed (`updated_at` in a later month than `paid`-month attribution).

- [ ] **Step 3: Won-push consistency (CRM → sales app):** for deals won in the last 30 days, compare `push-won-sale`'s recorded amount in the sales DB (`cthjxcftxwxbjpqmfiko`, table with `crm_deal_id`) against the CRM deal total — after the 2026-08-25 net-of-VAT fix, all should match net exactly; list mismatches.

- [ ] **Step 4: Outbox drain health for accounting identity:** stuck rows (`status='pending'` older than 1 hour), failed rows last 14 days, and `recover_stale_email_claims` effectiveness:

```sql
select identity, status, count(*), min(created_at) from public.email_outbox
where created_at > now() - interval '14 days' group by 1,2 order by 1,2;
```

- [ ] **Step 5: Record verdicts.**

---

### Task 8: Synthesis — the bug report

**Files:**
- Create: `docs/system-analysis/2026-08-26-payment-system-audit.md`
- Consume: `scratchpad/audit-findings.md`, `scratchpad/audit-baseline.json`

**Interfaces:**
- Produces: the final report the owner reads; nothing downstream.

- [ ] **Step 1: Merge all CONFIRMED findings**, ranked by money impact (€ first, then silent-failure risk, then hygiene). For every finding: what happens, why (root cause in code, file:line or function name), evidence (query + live numbers, dated), and what a fix would look like (one line — no fix is executed in this audit).

- [ ] **Step 2: Cross-reference the 2026-08-04 audit:** a table of A0–A8 + the 2026-08-06 sweep findings with today's status — FIXED / STILL OPEN (re-measured count) / WORSE / superseded. New findings get B-numbers (B1, B2, …).

- [ ] **Step 3: Separate the owner-decision list** (things that are policy, not bugs — e.g. suppressed deals with big balances, never-invoiced jobs) from the bug list, exactly like the prior audit did.

- [ ] **Step 4: Self-review the report against this plan:** every task's findings section represented; no REFUTED finding presented as a bug; A7 money-total caveat respected; every number carries its measurement date.

- [ ] **Step 5: Commit the report + update memory.**

```bash
git add docs/system-analysis/2026-08-26-payment-system-audit.md
git commit -m "docs(accounting): 2026-08-26 payment-system full audit report"
```

Update memory note `accounting-audit-open-findings` (or supersede it with the new state), and tell the owner the top findings in chat — report only; fixes are a follow-up plan after their call.
