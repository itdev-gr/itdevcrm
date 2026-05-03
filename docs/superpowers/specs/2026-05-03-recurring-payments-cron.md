# Recurring payments — automatic renewal + 2-minute live verification

**Date:** 2026-05-03
**Status:** approved (verbal)
**Related code:** `supabase/migrations/20260503000010_deal_payments.sql`, `src/features/accounting/hooks/useAccountingKanbanRealtime.ts`, `src/features/deals/PaymentsPanel.tsx`

## Problem

Recurring deal payments today rely on `ensure_recurring_payments()`, an RPC that is only invoked from the **frontend** when the accounting kanban is mounted. If nobody opens that page, no successor payment rows are ever created. For a CRM that must run unattended, this is a silent reliability bug — recurring revenue can stop being tracked without any visible failure.

The user must have **100% confidence** that the next month's payment row will appear on its own, with zero human action.

## Goal

1. Make `ensure_recurring_payments()` run on a server-side schedule, independently of the frontend.
2. Provide a **visible 2-minute test loop** so the user can watch a fresh row appear every two minutes on deal `000013`'s Payments tab — without touching the UI between renewals.

## Constraints

- The current `deal_payments.end_date` column is `date`, so the production cadence cannot be finer than one day. The test cadence has to live in a **separate, sub-day code path** to avoid bending the production model.
- The 2-minute test is scaffolding. Once the user is satisfied, the test cadence and its supporting columns must come out cleanly, leaving only the daily cron as the permanent change.
- No PRs — push directly to `main` (per project conventions).

## Design

### Permanent change

A `pg_cron` job named `daily_ensure_recurring_payments` runs every day at **02:00 UTC** and calls `public.ensure_recurring_payments()`. This is the load-bearing fix. After this is in place, the kanban-mount invocation in `useAccountingKanbanRealtime.ts` becomes a "freshen on visit" optimization rather than the only renewal path.

### Temporary test scaffolding

To support a sub-day cadence without disturbing the production date model:

1. **Schema:** add a nullable `next_due_at timestamptz` column to `deal_payments`. Production rows keep it `null`. Test rows leave `end_date` null and use `next_due_at` instead.
2. **Billing type:** allow `recurring_test_2min` in the `deal_payments.billing_type` CHECK constraint.
3. **Function:** extend `ensure_recurring_payments()` with one extra branch — when `billing_type = 'recurring_test_2min'`, the renewal window is `next_due_at <= now()` and the successor's `next_due_at = old.next_due_at + interval '2 minutes'`. The successor-exists check uses `next_due_at` instead of `start_date`.
4. **Cron:** schedule a second pg_cron job `every_minute_ensure_recurring_payments` at `* * * * *`.
5. **Data:** on deal `000013`, append a `test` entry to `services_planned` (label only — does not affect production billing) and insert one initial `deal_payments` row with `billing_type='recurring_test_2min'`, `amount=1.00`, `next_due_at=now() + interval '2 minutes'`.
6. **UI:** `PaymentsPanel` renders `next_due_at` formatted as a localized datetime when the row is `recurring_test_2min`; otherwise renders `end_date` as before. The "Add payment" form is **not** extended to allow creating test rows — they are seeded via migration only.

### What "100% confidence" looks like after this lands

- Open deal `000013`'s Payments tab. Note the count of test rows.
- Wait two minutes without doing anything.
- Reload (or watch realtime) — there is one more test row, with `next_due_at` exactly two minutes after the previous row's `next_due_at`.
- This proves: `pg_cron` is firing, `ensure_recurring_payments()` is running server-side, and the renewal SQL produces correct successors. The same code path serves the production daily run.

## Cleanup (deferred until user approves the test)

A subsequent migration will:

- Drop the `every_minute_ensure_recurring_payments` cron job.
- Strip the `recurring_test_2min` branch from `ensure_recurring_payments()`.
- Delete `recurring_test_2min` rows from `deal_payments`.
- Remove `recurring_test_2min` from the `billing_type` CHECK constraint.
- Drop the `next_due_at` column.
- Remove the `test` entry from deal `000013`'s `services_planned`.
- Revert PaymentsPanel changes for test cadence rendering.

The `daily_ensure_recurring_payments` cron and the production renewal logic stay in place forever.

## Out of scope

- The original brainstorming thread on **automatic client-status transitions** (lead→deal sets `new`; partial/full payment sets `active`; on-hold sets `blocked`; refunded→done archives the deal). Answer A was confirmed verbally; that work is parked until this verification is complete.
