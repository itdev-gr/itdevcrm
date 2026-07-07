# Expenses Autopay — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation
**Page:** `/accounting/expenses` (admin-only)

## Problem

Stable recurring expenses (rent, COSMOTE, CLAUDE, Google Workspace, Local Viking…) are charged automatically to the company card/account every period. The CRM already spawns each new period's expense row via the nightly `ensure_recurring_expenses()` cron (02:05 UTC), but every spawned row is born `pending` and an admin must manually "mark paid" each one, every month. That is busywork and, when skipped, understates paid expenses in the ledger/P&L.

## Decision summary (user-confirmed)

1. **Paid when?** Autopay rows flip `pending → paid` **on their period start date** (nightly), matching when the charge actually happens — not at spawn time (rows are spawned up to 7 days early).
2. **Backlog:** enabling autopay **also settles the chain's already-due pending rows immediately** (e.g. this month's overdue row).
3. **Payment method:** enabling autopay **requires a payment method** (DB `CHECK` demands one on paid rows); every auto-paid period reuses it.
4. **Approach:** nightly settle step + `autopay` flag (not spawn-as-paid, not settle-on-page-load). One clear owner of status transitions, same philosophy as the accounting-stage single-owner sweep.

## Design

### Database (one migration, `supabase/migrations/`)

1. **Column:** `alter table public.expenses add column autopay boolean not null default false;`
2. **Spawner update — `ensure_recurring_expenses()`:** copy `autopay` and `payment_method` from the source row onto the spawned next-period row (today `payment_method` is dropped). Everything else unchanged (renewal window, successor guard keyed on `coalesce(parent_expense_id, id)`).
3. **New function — `settle_autopay_expenses() returns integer`** (`security definer`, `set search_path = public`):
   ```
   update public.expenses
      set status = 'paid',
          paid_at = start_date::timestamptz,
          paid_by = null            -- shows as "System" in the activity log
    where autopay
      and status = 'pending'
      and start_date <= current_date
      and payment_method is not null
   ```
   Returns the number of rows settled. Never touches non-autopay chains or rows lacking a payment method.
4. **New RPC — `set_expense_autopay(p_expense_id uuid, p_enabled boolean, p_payment_method text default null)`:**
   - Guard: `current_user_is_admin()` (raise exception otherwise); revoke from `anon`, grant execute to `authenticated` (grant-boundary convention).
   - Resolves the chain key `coalesce(parent_expense_id, id)` of the target row.
   - Updates `autopay = p_enabled` on **all rows of the chain**; if `p_payment_method` is provided, sets it on rows where it is null (never overwrites an existing method on a paid row).
   - When enabling: validate the chain tip has a `payment_method` (else raise exception with a clear message), then settle the chain's due pending rows inline (same predicate as `settle_autopay_expenses`, scoped to the chain).
   - When disabling: flag update only; paid rows stay paid, pending rows stay pending for manual handling.
5. **Cron:** update the existing `daily_ensure_recurring_expenses` job command to run both steps in order:
   `select public.ensure_recurring_expenses(); select public.settle_autopay_expenses();`
   (unschedule + reschedule under the same name; no new cron entry).

Autopay is a **chain-level property**: the toggle RPC stamps every row so the spawner (which copies from the row being renewed) always inherits the current setting.

### Frontend (`src/features/accounting_report/`)

1. **`NewExpenseDialog.tsx`:** when billing type is `recurring_monthly`/`recurring_yearly`, show an "Autopay ⚡" toggle. Enabling it requires the payment-method field (submit disabled with a hint otherwise). On create with autopay: insert with `autopay: true`, then call `set_expense_autopay(id, true, payment_method)` so an already-due first period settles immediately. Toggle hidden for `one_time`.
2. **`ExpenseDetailDialog.tsx`:** an Autopay row with toggle (recurring expenses only). Enabling prompts for a payment method when the row has none, then calls `set_expense_autopay`. Disabling calls it with `false`. Surface RPC errors as a toast.
3. **`ExpenseRow.tsx` / `ExpensesPage.tsx`:** small ⚡ "Autopay" badge next to the status chip on autopay rows.
4. **Hooks:** new `useSetExpenseAutopay` mutation (`.bind(supabase)` convention; invalidates `['expenses']`, `['expense', id]`, `['accounting-ledger']`, `['accounting-pl-summary']`). `useExpenses`/`useExpenseDetail` pick up the new column automatically (`select *`), but typing must be extended where expense row types are declared.

### Edge cases & guardrails

- `one_time` expenses can never be autopay (UI hides the toggle; RPC raises if called on one).
- Settle stamps `paid_at = start_date` (midnight), so ledger/P&L attribute the expense to the correct month even when the sweep runs days later.
- Turning autopay off never un-pays anything.
- Receipts unchanged — an auto-paid row can still get a receipt attached later.
- RLS untouched: everything stays admin-only end-to-end (route `AdminGuard`, `expenses_all` policy, storage policy).
- Realtime: existing `useExpensesRealtime` invalidation covers nightly flips when the page is open.

## Testing

- **Frontend:** vitest with mocked Supabase (the suite runs against prod config — no live-write tests). Cover: toggle visibility (recurring vs one_time), payment-method requirement, RPC called with right args, badge rendering. `npm run build` (strict tsc + eslint) must pass.
- **Backend:** apply migration, then verify on prod via Management API:
  - Dry-run `settle_autopay_expenses()` inside `begin; ... rollback;` first, inspecting affected rows.
  - Read live function bodies via `pg_get_functiondef` before rewriting (drift rule).
  - After enabling autopay on one real expense, confirm chain flags, settled row, and cron command text.

## Changes / Revert

**Changes:** 1 migration (column + 2 function bodies + 1 RPC + cron command update), ~4 frontend files touched + 1 new hook + tests.

**Revert:**
```sql
-- restore cron
select cron.unschedule('daily_ensure_recurring_expenses');
select cron.schedule('daily_ensure_recurring_expenses', '5 2 * * *',
  $$select public.ensure_recurring_expenses();$$);
-- drop new objects
drop function if exists public.set_expense_autopay(uuid, boolean, text);
drop function if exists public.settle_autopay_expenses();
-- restore spawner to prior body (capture via pg_get_functiondef before applying; also in
-- supabase/migrations/20260601000004_ensure_recurring_expenses.sql)
-- drop column (autopay-paid rows keep status='paid'; no data loss beyond the flag)
alter table public.expenses drop column if exists autopay;
```
Frontend revert: `git revert` the feature commits.

## Out of scope

- A general edit-fields UI for expenses (`useUpdateExpense` hook exists but stays unwired).
- Notifications on auto-payment (silent by design; visible in list, activity log, and P&L).
- Changing amounts mid-chain (edit the latest row's amount before renewal, as today).
