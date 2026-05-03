# Plan — recurring payments: daily cron + 2-min verification

**Spec:** `docs/superpowers/specs/2026-05-03-recurring-payments-cron.md`

Each step ends with a single commit. Migrations are pushed at the end (Step 5) so we can verify them all together.

---

## Step 1 — Permanent: daily cron for `ensure_recurring_payments`

**File:** new migration `supabase/migrations/20260503000014_ensure_recurring_payments_daily_cron.sql`

**Contents:** schedule `daily_ensure_recurring_payments` at `0 2 * * *` calling `select public.ensure_recurring_payments();`. Wrap in `do $$ if exists pg_cron $$` guard, mirroring the existing pattern in `20260502000015`. Idempotent: unschedule first if a job with the same name already exists.

**Test:** after `supabase db push` (Step 5), `select * from cron.job where jobname='daily_ensure_recurring_payments'` returns one row.

**Commit:** `feat(billing): daily cron for ensure_recurring_payments`

---

## Step 2 — Test scaffolding migration

**File:** new migration `supabase/migrations/20260503000015_recurring_payments_test_2min.sql`

**Contents (single migration, single transaction):**

1. `alter table deal_payments add column if not exists next_due_at timestamptz`.
2. Drop and recreate the `billing_type` CHECK constraint to also accept `'recurring_test_2min'`.
3. `create or replace function ensure_recurring_payments()` — extend with a `union all` branch that selects `recurring_test_2min` rows whose `next_due_at <= now()` and whose successor (matched on `deal_id, service_index, next_due_at >= old.next_due_at`) does not yet exist. Successor insert uses `next_due_at = old.next_due_at + interval '2 minutes'`, `start_date = current_date`, `end_date = null`.
4. Schedule pg_cron `every_minute_ensure_recurring_payments` at `* * * * *`.

**Test:** function compiles; pushing the migration succeeds.

**Commit:** `feat(billing): 2-minute test cadence for ensure_recurring_payments`

---

## Step 3 — Seed test row on deal `000013`

**File:** same migration as Step 2 ends with a `do $$ ... end $$` block that:

1. Looks up the deal: `select id, services_planned into d_id, sp from deals where code='000013' limit 1`.
2. If found and `services_planned` doesn't already contain a `test` entry, append `{"service_type":"test","billing_type":"recurring_test_2min","monthly_amount":"1.00"}` to it.
3. If no `recurring_test_2min` row exists for that deal, insert one: `service_type='test'`, `service_index = (max+1)`, `billing_type='recurring_test_2min'`, `amount=1.00`, `start_date=current_date`, `end_date=null`, `next_due_at=now() + interval '2 minutes'`.

Bundling with Step 2 keeps the test scaffolding together for one-shot cleanup later.

**Test:** after push, `select count(*) from deal_payments where billing_type='recurring_test_2min'` returns 1.

**Commit:** folded into Step 2.

---

## Step 4 — Frontend: render `next_due_at` for test rows

**Files:**
- `src/types/supabase.ts` — regenerated via `npm run types:gen` after the migration is on the remote.
- `src/features/deals/hooks/useDealPayments.ts` — pull `next_due_at` through (it'll come for free from `select *`, but the type needs to flow).
- `src/features/deals/PaymentsPanel.tsx` — when `row.billing_type === 'recurring_test_2min'`, replace the `end_date` cell with a read-only formatted datetime of `next_due_at` (use `formatDateTime` from `lib/datetime` if it exists, otherwise inline `new Date(...).toLocaleString()`). Hide the inputs (amount/start/end) for test rows; they are auto-managed.

**Test:** open deal `000013` Payments tab. The test row shows `next_due_at` as a datetime; production rows render unchanged.

**Commit:** `feat(payments): show next_due_at for recurring_test_2min rows`

---

## Step 5 — Push and verify

1. `supabase db push` — applies migrations 14 and 15 to remote.
2. `npm run types:gen` — regenerate `src/types/supabase.ts` so `next_due_at` is in the type union.
3. Open deal `000013` in the running app. Note current test-row count.
4. Wait 2 minutes without touching anything.
5. Reload — confirm one new test row.
6. Wait another 2 minutes — confirm a second new test row.

If verification passes, ping the user. They will then say "delete the two minutes" and we'll write the cleanup migration as a follow-up (not in this plan).

**Commit:** none — Step 5 is pure verification.

---

## Notes

- `ensure_recurring_payments()` is `security definer`. It does not check `current_user_is_admin()`, so pg_cron (running as `postgres`) can invoke it cleanly.
- The function returns `int`. The cron `select` discards it — no extra logging table needed.
- If pg_cron is disabled in the remote project, Step 1 and Step 2 silently no-op (the existing guard pattern). The user's project is on Supabase Pro, so pg_cron is available.
