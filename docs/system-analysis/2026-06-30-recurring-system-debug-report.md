# Recurring Payments System — Debug Report

**Date:** 2026-06-30
**Scope:** End-to-end audit of recurring billing, overdue marking, On Hold ↔ Paid In Full lifecycle, and per-period generation.

**Verdict (revised after pulling live prod state):**
- **Bug #1 (release-from-on-hold trigger) is a FALSE POSITIVE** on prod. The trigger is correctly wired and uses the intended 2026-06-26 logic. The "bug" was an artifact of reading the local repo's migration files, which include a never-applied file (`20260623150000_recurring_due_date_lifecycle.sql`) that *would* have introduced the bug had it been applied.
- **Bug #2 (€0 recurring amount guard) is real.** 2 active recurring jobs are currently generating €0 invoices every month — listed below.
- A separate **operational risk**: the local migration directory has many files with timestamps that don't match the versions in prod's `schema_migrations`. Running `supabase db push` would attempt to re-apply (or apply for the first time) several function/trigger swaps that are already in prod with different bodies. **Do not run `supabase db push` against prod without an audit first.**

---

## The system in one diagram (verified against live function bodies)

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
                          ⚠️ Bug #2: no `amount_net > 0` guard — €0 jobs propagate

   ── Daily 02:15 UTC ──→  mark_overdue_payments()
                          recurring: start_date <= today  → overdue
                          one_time : end_date   <  today  → overdue
                          (✅ verified live on prod with start_date basis)

   ── Daily 02:20 UTC ──→  reconcile_block_lifecycle()
                          target_accounting_stage(next_due, today):
                            next_due IS NULL          → paid_in_full
                            next_due <= today         → on_hold
                            next_due <= today + 7     → awaiting_payment
                            else                      → paid_in_full
                          On Hold → Paid In Full only if p_allow_release=true
                          (nightly run passes false; payment, not cron, releases)

   ── On payment paid ─→   deal_payments_release_from_on_hold (TRIGGER, live on prod)
                          scope: on_hold OR partial_payment
                          guard: payment_method IS NOT NULL
                          date:  start_date <= today (any billing_type)
                          → stage = paid_in_full + deals_hold_jobs_on_stage_change fires
                          → release_jobs_for_deal + release_deal_jobs unblock jobs

   ── On stage move ──→   deals_hold_jobs_on_stage_change
                          on_hold       → block_deal_jobs (everything except web_dev/hosting)
                          paid_in_full  → release_jobs_for_deal(false) + release_deal_jobs
                          partial_payment → no-op (partial-release trigger owns it)
```

---

## ✅ Bug #1 — Release-from-on-hold trigger swap — NOT A BUG ON PROD

### What I originally claimed

That migration `20260626000011_release_duedate_and_awaiting_guard.sql` redefined `deal_payments_release_from_on_hold()` with the intended new scope and guard, but never wired a trigger to it — so the OLD `deal_payments_settle_to_paid_in_full` trigger was supposedly still running with the prior logic.

### What's actually live on prod

```sql
-- single trigger on deal_payments matching either name:
tgname:    deal_payments_release_from_on_hold
function:  deal_payments_release_from_on_hold
tgenabled: 'O' (enabled)

-- function body byte-for-byte matches the intended 20260626000011 body:
declare cur_code text; paid_stage_id uuid; has_pm boolean;
begin
  if new.status <> 'paid' or old.status is not distinct from 'paid' then return new; end if;
  select ps.code, (d.payment_method is not null) into cur_code, has_pm
    from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where d.id = new.deal_id;
  if cur_code is null or cur_code not in ('on_hold','partial_payment') or not has_pm then
    return new;
  end if;
  …
```

### Why my analysis was wrong

The local file `supabase/migrations/20260623150000_recurring_due_date_lifecycle.sql` contains a block that drops `deal_payments_release_from_on_hold` (trigger + function) and creates a replacement `deal_payments_settle_to_paid_in_full` trigger. That code is exactly what would cause the bug — but **this migration file was never applied to prod**. It is not in `supabase_migrations.schema_migrations`.

The actually-applied prod migrations include:
- `20260623113839 paid_in_full_recurring_unlock` — created the release trigger and original function body.
- `20260626134318 release_duedate_and_awaiting_guard` — replaced the function body with the intended new body via `create or replace function`, no trigger touch needed.

End result: trigger from 06-23, body from 06-26, both correct.

### Action

- I deleted the unnecessary "fix" migration I'd written earlier (`20260630000000_fix_release_trigger_wiring.sql`).
- The local file `20260623150000_recurring_due_date_lifecycle.sql` is a **landmine** — if it ever gets applied (by `supabase db push`, by a fresh-environment bootstrap, or by accident), it will drop the live release trigger and replace it with the buggy settle pattern. We should either delete it from the repo or rename it to make it obvious it's archival/never-apply.

---

## 🐛 Bug #2 — No €0 guard on the recurring generator — REAL ON PROD

### Confirmation

Live body of `ensure_recurring_payments()` on prod has no amount-net filter — it copies `r.amount_net` forward unconditionally. The DB constraint `deal_payments_amount_net_nonneg` only forbids negative values.

### Current blast radius (live query, 2026-06-30)

Two active recurring jobs are currently generating €0 invoices every period:

| Job code | Service | Cadence | Client |
| --- | --- | --- | --- |
| `000084-LOCALSEO` | local_seo | recurring_monthly | Afuera |
| `000306-SOCIAL-2` | social_media | recurring_monthly | ΠΑΛΗΚΥΡΑΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΓΕΡΑΣΙΜΟΣ |

(Excluding AI SEO child jobs, which are intentionally €0 because the parent owns billing.)

### Recommended fix (not applied)

Two layers — pick one or both:

```sql
-- 1) Guard at generation: skip the row if no money would be billed.
-- (Add to the WHERE clause of the candidate set in ensure_recurring_payments.)
and coalesce(dp.amount_net, 0) > 0

-- 2) Constraint: refuse the row at insert time. ONLY add after backfilling
--    the 2 jobs above, otherwise the next cron run will throw.
alter table public.deal_payments
  drop constraint if exists deal_payments_amount_net_nonzero,
  add constraint deal_payments_amount_net_nonzero check (amount_net > 0);
```

Before applying either, set the correct `amount_net` on the two jobs and any €0 `deal_payments` rows they spawned.

---

## ⚠️ Smell #1 — One-time off-by-one between overdue marking and stage move

(Unchanged from initial report — code-level concern, verified by direct read of `mark_overdue_payments` body on prod.)

`mark_overdue_payments` flips a one-time row to `overdue` when `end_date < current_date` (strict).
`target_accounting_stage` moves the deal to `on_hold` when `next_due <= today` (inclusive of today; for one-time, `next_due = start_date = end_date = close_date`).

So a one-time payment due today: deal goes On Hold today, payment chip stays "Pending" till tomorrow.

Cosmetic only — no money lost, just a confusing badge. Align by using `<=` on both sides if you want it tidy.

---

## ⚠️ Smell #2 — VAT hardcoded for non-Cyprus clients

(Unchanged.) `seed_deal_payments` and `release_billing_jobs_for_deal` use `case when country ilike 'cyprus' then 0 else 24`. Any other VAT (e.g. Bulgaria 20%) gets tagged 24%.

---

## ⚠️ Smell #3 — Dormant v2 of `ensure_recurring_payments`

(Unchanged.) `ensure_recurring_payments_v2()` exists; cron schedules the v1 (`ensure_recurring_payments`). If someone accidentally swaps them, v2 writes €0 headers.

---

## ⚠️ Smell #4 — Disabled cron lingers in `cron.job`

(Unchanged.) `daily_move_overdue_deals_to_on_hold` is `active=false` in `cron.job` rather than unscheduled.

---

## 🚨 NEW Operational risk — Local repo ↔ prod migration drift

The local `supabase/migrations/` directory has version numbers that do NOT match `supabase_migrations.schema_migrations` on prod. Prod uses minute-second timestamps from when each migration was applied (e.g. `20260623113839`); local files use zero-padded sequential timestamps (e.g. `20260619150000`).

Implication: `supabase db push` would treat dozens of local files as "pending" and attempt to apply them. Several of them redefine functions and triggers that already exist on prod with NEWER bodies. Applying them would silently DOWNGRADE prod logic.

**Don't run `supabase db push` against prod.** If you want to formally sync the repo to prod, the safe path is:

1. `supabase db dump --schema public > docs/system-analysis/schema-prod-2026-06-30.sql` (snapshot).
2. Decide whether to (a) realign local file timestamps to match prod, or (b) treat the local dir as archive-only and apply future migrations exclusively via MCP / Supabase Studio.

This is out of scope for "fix the recurring bug" — flagging it because I tripped over it during this audit.

---

## Recommended order if you want to act

1. **Backfill the 2 €0 recurring jobs** (set `jobs.amount_net` and the active `deal_payments.amount_net` rows).
2. **Add the €0 guard** in `ensure_recurring_payments` (via a new MCP migration — not via the local dir).
3. (Optional) align the one-time off-by-one in mark/move.
4. (Operational) decide what to do about the migration-dir drift.

I have NOT made any DB changes — this analysis is read-only. Tell me which fixes you want and I'll write the SQL for each as a proper MCP migration.

---

## Trust footnote

When I first wrote this report I made a confident claim about Bug #1 based on reading the local migration files. Pulling live `pg_proc`/`pg_trigger` rows immediately disproved it. Lesson going forward: trust `pg_proc` over the file system for any "is this bug live?" question — the schema migration history on prod is the ground truth, not the repo.
