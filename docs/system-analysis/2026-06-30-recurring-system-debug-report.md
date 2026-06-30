# Recurring Payments System — Debug Report

**Date:** 2026-06-30
**Scope:** End-to-end audit of recurring billing, overdue marking, On Hold ↔ Paid In Full lifecycle, and per-period generation.
**Verdict:** Two concrete bugs (one is a wiring bug that silently dropped intended behavior); several smells worth tightening.

---

## The system in one diagram

```
                      ┌───────────────────────────────────────┐
                      │  Deal won  →  seed_deal_payments      │
                      │  creates initial deal_payments row(s) │
                      └──────────────────┬────────────────────┘
                                         │ AFTER INSERT trigger
                                         ▼
                       ┌────────────────────────────────────┐
                       │  deal_payments_move_to_awaiting    │
                       │  → stage = awaiting_payment        │
                       └────────────────────────────────────┘

   ── Daily 02:00 UTC ──→  ensure_recurring_payments()
                          generates next period when current ends ≤ today+7

   ── Daily 02:15 UTC ──→  mark_overdue_payments()
                          recurring: start_date <= today  → overdue
                          one_time : end_date   <  today  → overdue

   ── Daily 02:20 UTC ──→  reconcile_block_lifecycle()
                          for each non-terminal deal with payment_method:
                            target = target_accounting_stage(next_due, today)
                              next_due IS NULL          → paid_in_full
                              next_due <= today         → on_hold
                              next_due <= today + 7     → awaiting_payment
                              else                      → paid_in_full
                          (when on_hold→paid_in_full, only acts if p_allow_release=true,
                           cron passes false so payment, not cron, releases On Hold)

   ── On payment paid ─→   deal_payments_settle_to_paid_in_full   ← TRIGGER (active)
                          if all unpaid past due_date are gone:
                            stage → paid_in_full
                          + deals_hold_jobs_on_stage_change releases jobs

   ── On stage move ──→   deals_hold_jobs_on_stage_change
                          on_hold        → block_deal_jobs  (every job except web_dev/hosting)
                          paid_in_full   → release_jobs_for_deal + release_deal_jobs
                          partial_payment → (no-op, partial trigger owns it)
```

---

## 🐛 Bug #1 — Dead release function: the trigger swap was forgotten

**Severity:** Medium. The OLD release behavior still works, but the INTENDED improvements from 2026-06-26 are not applied.

### What happened

Migration `20260626000011_release_duedate_and_awaiting_guard.sql` re-declares a function called `public.deal_payments_release_from_on_hold()` with a NEW body that adds three improvements over the prior version:

1. Scope expanded to include **partial_payment** (so partially-paid deals get auto-released when the rest of the money lands).
2. Drops **awaiting_payment** from the auto-release scope (so paying one row in Awaiting no longer silently jumps the deal to Paid In Full).
3. Adds a `payment_method IS NOT NULL` guard (so the release never trips `guard_payment_method_before_stage_move`).

**But the migration only redefines the function — it does NOT create a trigger that calls it.**

The trigger that was wired in `20260623150000_recurring_due_date_lifecycle.sql` is **still** `deal_payments_settle_to_paid_in_full` → `deal_payments_settle_to_paid_in_full()`. Nothing dropped it; nothing pointed the new function at the trigger.

### What's running on prod right now

| Aspect | Intended (`20260626000011`) | Actually running (`20260623150000`) |
| --- | --- | --- |
| Trigger name | (none — function is orphaned) | `deal_payments_settle_to_paid_in_full` (active) |
| Auto-release scope | `on_hold` OR `partial_payment` | `on_hold` OR `awaiting_payment` |
| `payment_method IS NOT NULL` required | yes | no |
| Date basis | `start_date <= today` (uniform) | recurring `start_date <= today`, one_time `end_date <= today` |

### Practical impact

- **Partial Payment deals never auto-release.** If a deal is in `partial_payment` and the final invoice gets paid, the deal stays in `partial_payment` instead of moving to `paid_in_full`. Accounting must move it by hand.
- **Awaiting Payment deals still auto-jump to Paid In Full.** A row paid early (or seed-only deals with `services_planned=[]`) can silently jump to `paid_in_full` when there's nothing left unpaid past the due date. That side effect was meant to be turned off but isn't.
- **No `payment_method` guard.** The release fires even when the deal has no payment method set. Today this can throw — `guard_payment_method_before_stage_move` rejects stage moves to `paid_in_full` if `payment_method` is null. Symptom would be a `RAISE EXCEPTION` from the trigger when marking an unpaid-row paid on a no-PM deal. (Worth grepping logs for it.)

### Verification (no DB access required for the function-level fact)

```bash
grep -nE "create (or replace )?function public\.deal_payments_release_from_on_hold|create (or replace )?function public\.deal_payments_settle_to_paid_in_full|create trigger deal_payments_(release_from_on_hold|settle_to_paid_in_full)" supabase/migrations/*.sql
```

You'll see:
- Trigger `deal_payments_release_from_on_hold` was CREATEd in `20260623140000`, DROPped in `20260623150000`. Never recreated.
- Trigger `deal_payments_settle_to_paid_in_full` was CREATEd in `20260623150000`. Never dropped.
- Function `deal_payments_release_from_on_hold()` was DROPped in `20260623150000`, redeclared in `20260626000011`. **No trigger references it.**

### Fix sketch (one tiny migration — do NOT apply without your OK)

```sql
-- Restore the intended wiring from the missed 20260626000011 step.
drop trigger if exists deal_payments_settle_to_paid_in_full on public.deal_payments;
drop function if exists public.deal_payments_settle_to_paid_in_full();
drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
create trigger deal_payments_release_from_on_hold
  after update on public.deal_payments
  for each row execute function public.deal_payments_release_from_on_hold();
```

Before applying, double-check on live DB:
```sql
-- 1. Confirm the trigger gap is real.
select tgname, tgrelid::regclass, tgenabled
  from pg_trigger
 where tgname in ('deal_payments_release_from_on_hold','deal_payments_settle_to_paid_in_full');

-- 2. List partial_payment deals that have NO remaining unpaid past due — those are
-- the ones the dead-code function would have rescued, sitting stuck in partial_payment.
select d.id, d.code, count(*) filter (where dp.status <> 'paid' and dp.start_date <= current_date) as overdue_left
  from public.deals d
  join public.pipeline_stages ps on ps.id = d.accounting_stage_id
  left join public.deal_payments dp on dp.deal_id = d.id
 where ps.code = 'partial_payment'
 group by d.id, d.code
having count(*) filter (where dp.status <> 'paid' and dp.start_date <= current_date) = 0;
```

---

## 🐛 Bug #2 — No €0 guard on the recurring generator

**Severity:** Medium. Silent — invoices keep being generated with €0, no error.

### What happens

`ensure_recurring_payments()` (live in `20260619150000_recurring_idempotency_by_index_plus_lock.sql:14`) copies `amount_net` from the previous period's deal_payments row into the next one. There is no `WHERE amount_net > 0` clause. The DB constraint `deal_payments_amount_net_nonneg` only forbids NEGATIVE values, not zero.

`seed_deal_payments()` (live in `20260616110538_seed_payments_net_basis.sql:17`) likewise inserts whatever `monthly_amount`/`one_time_amount` was on `services_planned`, defaulting missing values to 0.

The memory snapshot from 2026-06-23 found **117 recurring jobs with `amount_net = 0`**. Whether that has been backfilled or not, the code path remains the same — any €0 row will perpetuate itself forever, and any new job seeded without an amount becomes a self-replicating €0 series.

### Detection query

```sql
-- €0 recurring jobs that are still active:
select id, code, deal_id, service_type, billing_type, amount_net, billing_active
  from public.jobs
 where billing_type in ('recurring_monthly','recurring_yearly')
   and billing_active = true
   and not archived
   and coalesce(amount_net, 0) = 0;

-- €0 pending/overdue payment rows on active deals:
select dp.deal_id, dp.id, dp.service_type, dp.billing_type, dp.amount_net, dp.start_date, dp.end_date, dp.status
  from public.deal_payments dp
  join public.deals d on d.id = dp.deal_id
 where d.archived = false
   and dp.status in ('pending','overdue')
   and coalesce(dp.amount_net, 0) = 0;
```

### Fix sketch

Add a guard in `ensure_recurring_payments()`:

```sql
-- inside the SELECT that builds the candidate set:
and coalesce(dp.amount_net, 0) > 0
```

And/or a database constraint:

```sql
alter table public.deal_payments
  drop constraint if exists deal_payments_amount_net_nonzero,
  add constraint deal_payments_amount_net_nonzero check (amount_net > 0);
```

Caveat: the constraint would reject any historical/legitimate €0 row (e.g. AI SEO children which intentionally carry amount_net=0 because the parent owns the billing — but those should never appear in `deal_payments` since they're billing_only=false on the child side). If you add the constraint, run the detection query first and fix any €0 rows.

---

## ⚠️ Smell #1 — One-time off-by-one between overdue marking and stage move

`mark_overdue_payments()` flips one-time rows to `overdue` when `end_date < today` (strict).
`move_overdue_deals_to_on_hold()` / `target_accounting_stage()` moves the deal to On Hold when `end_date <= today` (inclusive).

For a one_time payment due TODAY:
- Deal lands in On Hold during the 02:20 UTC reconcile.
- Payment row stays `pending` (not flipped to `overdue` until tomorrow's 02:15 UTC).

**Practical impact:** the kanban card shows a deal "On Hold" with a "Pending" payment chip — confusing label for a few hours. Not financially incorrect, but worth aligning to one rule.

**Fix:** make the recurring branch use `<=` and one_time also use `<=` in both functions. Or document that one_time is strict.

---

## ⚠️ Smell #2 — VAT hardcoded for non-Cyprus clients

`seed_deal_payments()` and `release_billing_jobs_for_deal()` both compute VAT as `case when client.country ilike 'cyprus' then 0 else 24 end`. Any EU client with a different VAT (Bulgaria 20%, Spain 21%, France 20%, …) ends up tagged with 24% and accounting has to fix it by hand later.

Low risk for the current Greece-focused customer base, but worth a `country → vat_rate` lookup if you start signing EU clients.

---

## ⚠️ Smell #3 — Dormant v2 of `ensure_recurring_payments`

A v2 of the generator (`ensure_recurring_payments_v2()`) exists in `20260617000012` but is NOT scheduled — the cron still calls v1 (live in `20260619150000`). If someone accidentally re-enables v2 before backfilling jobs' `amount_net`, the v2 would write €0 headers for every recurring deal.

Either delete v2 or rename it to `_disabled_v2` to make the dormancy explicit.

---

## ⚠️ Smell #4 — Disabled cron lingers in `cron.job`

`20260626000012` uses `cron.alter_job(..., active := false)` to retire `daily_move_overdue_deals_to_on_hold` rather than `cron.unschedule`. The job row stays in `cron.job` with `active=false`. Cosmetic, but the next person to inspect cron will see a "ghost" job and wonder if it's safe to re-enable. (It's not — the reconciler supersedes it and would conflict.)

---

## What I checked and decided was fine

- **Paid In Full is non-terminal** — confirmed in `20260623140000:14`. The reconciler correctly excludes only `done` and `closed`.
- **`security definer` functions all set `search_path`** — no path-injection holes spotted.
- **Idempotency lock in the recurring generator** — `pg_advisory_xact_lock(hashtext('ensure_recurring_payments'))` correctly serializes concurrent runs (cron + frontend mount).
- **`deals_hold_jobs_on_stage_change` trigger** — correctly blocks/unblocks jobs on stage transitions (web_dev + hosting carved out, AI SEO parent+children treated as one unit).
- **`mark_overdue_payments` due-date basis** — the 2026-06-28 fix correctly switched recurring rows to `start_date <= today` and silently backfilled the 98 lagging rows.
- **`accounting_mark_paid_in_full` RPC** — correctly branches on "has jobs / has accounting_completed_at" (established → just unlock) vs fresh onboarding (→ `complete_accounting`).

---

## Recommended order if you want to act

1. **First, run the detection queries above** to size the blast radius:
   - How many `partial_payment` deals are stranded (Bug #1 effect)?
   - How many €0 recurring rows are currently active (Bug #2 effect)?
2. **Fix Bug #1 with the one-line trigger swap** above (low risk, restores the intended 2026-06-26 behavior).
3. **Backfill €0 amounts in `jobs.amount_net` and `deal_payments.amount_net`** before adding the constraint or the guard.
4. **Add the €0 guard to `ensure_recurring_payments` and (optionally) the DB constraint.**
5. (Optional) Align the one-time off-by-one in mark/move.

I have NOT made any changes — this is read-only analysis. Tell me which fixes you want and I'll write the migrations and the rollback for each.
