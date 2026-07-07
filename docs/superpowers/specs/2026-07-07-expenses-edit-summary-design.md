# Expenses Edit + Summary — Design

**Date:** 2026-07-07
**Status:** Designed (user away; both recommended options assumed — full edit, filtered totals). Pending user spec review.
**Page:** `/accounting/expenses` (admin-only, unchanged)

## Problem

1. Expenses cannot be edited after creation — a typo in amount/vendor/date requires delete + recreate. The `useUpdateExpense` hook exists (fully implemented + tested) but is wired to no UI.
2. The page has no totals — the admin cannot see what the filtered list adds up to (e.g. "how much did July cost?").

## Design

### 1. Edit (frontend-only; no DB changes)

- **Entry point:** an **Edit** button in `ExpenseDetailDialog` (next to Delete/Cancel). Clicking swaps the read-only body for an edit form; Cancel returns to read-only view without saving.
- **New component:** `src/features/accounting_report/components/ExpenseEditForm.tsx` — rendered inside the detail dialog. `NewExpenseDialog` is NOT modified (protects the fresh autopay tests).
- **Fields (pre-filled from the row):** category, vendor, billing type, amount_net, vat_rate, start_date, end_date, payment_method, notes. Same field styling/labels as the create dialog (reuse i18n keys `expense_form.*`; `expense_form.edit_title` already exists in both locales).
- **Saves via `useUpdateExpense`** (existing hook: patches exactly those columns, invalidates expenses/detail/ledger/PL queries).
- **Never touched by edit:** `status`, `paid_at`, `paid_by`, `autopay`, `receipt_path` — those keep their existing dedicated controls (Mark paid, Autopay toggle, Upload receipt, Delete).
- **Validation (mirrors create):** category required, amount_net required (≥ 0), start_date required, end_date ≥ start_date when both set. Errors inline, same pattern as create.
- **Paid rows are editable** (typo fixes). Generated columns (`vat_amount`, `amount_gross`) recompute in the DB automatically.
- **Recurring-chain hint:** for `recurring_monthly`/`recurring_yearly` rows, a muted hint under the form: future periods are spawned from the chain's latest row — edit the newest row to change future amounts; editing an older row only corrects history. (Hint only; no chain-propagation logic. New i18n key `expense_form.edit_chain_hint` in en+el.)

### 2. Summary (client-side; no new queries)

- **New component:** `src/features/accounting_report/components/ExpensesSummaryBar.tsx`, rendered in `ExpensesPage` between the filter bar and the table.
- **Computes from the already-fetched filtered rows** (`useExpenses` returns the full filtered list; no pagination on this page):
  - count of expenses,
  - totals: Net / VAT / Gross,
  - Pending vs Paid split (gross) — meaningful on "All"; degenerate (one side 0) when a status filter is active, which is fine.
- **Month picker in the filter bar:** a `<select>` with "All time" (default) plus the last 24 calendar months (static list computed from today, newest first — NOT derived from the fetched rows, which would be circular once a month is selected), mapped to the hook's existing `from`/`to` filters (`start_date` gte/lte). Default "All time" preserves today's behavior. The summary therefore answers "how much this month?" when a month is picked.
- Formatting: `€X.XX` like the table cells; tabular-nums.

### 3. Out of scope

- No pagination changes, no server aggregation (list sizes are small; the P&L report page already covers monthly reporting).
- No editing of receipts (upload flow unchanged), no chain-wide amount propagation.
- No changes to `NewExpenseDialog`, autopay, or any DB object.

## Testing

- `ExpenseEditForm` tests (mocked hooks): prefills all fields from the row; validation blocks bad saves; save calls `useUpdateExpense.mutateAsync` with exactly the changed columns and never `status`/`paid_at`/`autopay`; Cancel discards.
- `ExpensesSummaryBar` tests: totals math over a fixture list; pending/paid split; count.
- Month-picker test: selecting a month passes `from`/`to` to `useExpenses` (existing filter plumbing).
- `npm run build` strict gate; vitest fully mocked (suite runs against prod config).
- Live smoke: edit a real expense's vendor and revert it; verify summary numbers against a SQL sum.

## Changes / Revert

**Changes:** 2 new components + tests; `ExpenseDetailDialog.tsx` (Edit button + form swap), `ExpensesPage.tsx` (summary bar + month picker), i18n en/el (a handful of keys). Frontend-only.

**Revert:** `git revert` the feature commits — no DB migration, no data effects (edits themselves are ordinary row updates covered by the activity log).
