# Deal page: editable "Delivery deadline" column on the Jobs table

**Date:** 2026-07-30 · **Status:** Implemented

## Goal

The deal-page Jobs table (`JobsBillingPanel`, deal **Επισκόπηση** tab) already shows a
**billing** due-date column («Προθεσμία πληρωμής», `jobs.period_due_date`). Owner wants a
**second** column for the **delivery deadline** of the work («Προθεσμία παράδοσης»,
`jobs.details.due_date`) — and to be able to **set it for ANY job type** from this panel,
not just web_dev (which was the only surface before, on its Info tab).

## Owner decisions

1. New column is **editable for all job types** (date picker per row in edit mode); writes
   `jobs.details.due_date` (ISO yyyy-mm-dd). Existing web-dev deadlines show here too.
2. **Red when overdue**, plain otherwise; «—» when unset (read-only mode / no edit rights).
3. Placed **right after** the billing due-date column.

## Implementation (frontend-only, no migration)

- **`hooks/useJobsBilling.ts`** — add `details` to the jobs select; expose `details`
  (raw, for merge) + `delivery_due_date` (= `details.due_date` when a non-empty string) on
  `JobBillingRow`.
- **`hooks/useCustomJobMutations.ts`** — `mergeDueDate(details, dueDate)` pure helper
  (merges/clears the `due_date` key without dropping website/industry/etc.) +
  `useUpdateJobDeliveryDueDate(dealId)` mutation that writes `jobs.details` directly
  (`supabase.from('jobs').update`) — NOT the billing RPC. Invalidates billing + `job(id)` +
  `jobsByService(dept)` + `dealServiceJobs`. RLS `jobs_update_accounting` /
  `jobs_mutate_admin_or_service` cover the accounting + admin users who get edit mode.
- **`JobsBillingPanel.tsx`** — new `<th>` `col_deadline`; new `<td>` after the
  `period_due_date` cell: read-only formatted date (red via existing `isDueOverdue`) or an
  `<Input type="date">` in edit mode calling the mutation on change; note-preview `colSpan`
  7 → 8.
- **i18n** — `jobs_billing.col_deadline`: en "Delivery due", el «Προθεσμία παράδοσης».

## Intended side effect

Setting `details.due_date` on a non-web_dev job makes the existing delivery chip
(`jobDueDateChip` in `JobsKanbanCard`, rendered whenever `details.due_date` exists) appear on
that job's card on its own board. Verified live: setting a deadline on a web_dev job from the
panel produced the «15/09» chip on its Web Dev card alongside the billing "Due" chip.

## Verification (done 2026-07-30, dev against prod DB)

- Unit: `useCustomJobMutations.test.tsx` (mergeDueDate + mutation, 8/8) green; 4 new
  `JobsBillingPanel.test.tsx` deadline tests green (rest of that file is pre-existing
  jest-dom-broken and was left as-is). `npm run build` clean.
- E2E (deal 000066): column renders; set a deadline on a **web_dev** row → `details` kept
  `website`+`industry` and gained `due_date` (merge verified); set one on a **hosting** row
  (details was `{}`) → works for non-web_dev; values persist on reload; web_dev card shows the
  chip. Test values were reverted afterwards (dev hits prod).

## Rollback

Frontend-only → `git revert`. Leftover `details.due_date` keys are inert.
