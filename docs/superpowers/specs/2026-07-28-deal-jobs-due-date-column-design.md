# Deal page: Due date column on the Jobs table

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation

## Goal

Accounting works from the deal page (`/deals/<id>`) and needs to see, per job,
when its next payment is due. Add a **Due date** column to the Jobs table of
`JobsBillingPanel`, right after the Status column.

## Owner decisions

1. **Data source**: `jobs.period_due_date` — the same derived
   "paid-until / next payment due" date the SEO kanban chips
   (`formatJobPeriodChip`) and the hosting/maintenance/domains list pages
   already show. No new derivation.
2. **Styling**: plain formatted date (`formatDate`, locale-aware), rendered
   **red when the date is in the past** (overdue), matching the boards'
   overdue semantics. "—" when null (no paid coverage / one-time job).
3. Column shows in **both** editable and read-only modes of the panel.

> Distinct from `2026-07-28-webdev-due-date-design.md` (manual web_dev
> *delivery* date in `jobs.details.due_date`). This column is the *billing*
> period due date.

## Changes

1. **`src/features/deals/hooks/useJobsBilling.ts`**
   - Add `period_due_date` to the jobs `select` string.
   - Add `period_due_date: string | null` to `JobBillingRow` + mapping.
2. **`src/features/deals/JobsBillingPanel.tsx`**
   - New `<th>` `{t('jobs_billing.col_due_date')}` between Status and Group.
   - New `<td>` in `JobRow` between the status and group cells:
     `formatDate(job.period_due_date)` or "—"; `text-red-600
     dark:text-red-400` when the date < today (UTC date compare, same
     day-boundary logic as `formatJobPeriodChip`).
   - Note-preview row `colSpan` 6 → 7.
3. **i18n** — `jobs_billing.col_due_date` in
   `src/i18n/locales/en/deals.json` ("Due date") and
   `src/i18n/locales/el/deals.json` ("Προθεσμία πληρωμής").

## Testing (TDD)

- `JobsBillingPanel.test.tsx`: column header renders; a job with
  `period_due_date` shows the formatted date; null shows "—"; past date gets
  the red class, future date does not.

## Out of scope (YAGNI)

- No sorting by due date.
- No change to the Payments card list below (already shows per-payment dates).
- No DB / RPC / migration work — `period_due_date` already exists on `jobs`
  and is covered by existing RLS.

## Changes / Revert

- Frontend-only; no migrations, no data writes.
- Revert = `git revert` of the implementation commit.
