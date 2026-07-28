# Web Dev delivery due date

**Date:** 2026-07-28
**Status:** Implemented 2026-07-28 (commits 1306336..ba8df7e)

## Goal

Web Dev jobs (websites) get a manually assigned delivery due date, set by the
web dev department on the job's Info tab, and visible as an urgency-colored
chip on the cards of the Web Dev kanban.

## Owner decisions

1. **Edit surface**: a new "Due date" field on the web_dev Info tab (next to
   Website / Industry / Hosting). Auto-saves like the other Info fields.
2. **Permissions**: same as the other Info-tab fields — anyone who can open
   the job page can edit it (in practice the web dev department + admins).
   No new permission gate.
3. **Card display**: urgency-colored chip — red when past due, amber when
   ≤ 7 days away, neutral gray otherwise. Visually distinct from the
   green/amber/red *billing* "Due dd/mm" period chip.

## Data

- New key `due_date` in `jobs.details` (JSONB), ISO `yyyy-mm-dd` string,
  written only for `web_dev` jobs (the field only exists in the web_dev
  Info-field list).
- **No DB migration.** `jobs.details` already exists, RLS already covers it,
  and the kanban query (`useJobs`) selects `*` so cards receive it for free.

## Frontend changes

1. **`serviceInfoFields.ts`**
   - Add `'date'` to `InfoFieldType`.
   - Add to `WEB_DEV`, positioned after `industry`:
     `{ key: 'due_date', labelEn: 'Due date', labelEl: 'Προθεσμία παράδοσης', type: 'date' }`.
   - Not `sharedWithDeal` (deal Overview untouched).
2. **`JobInfoPanel.tsx`** — `FieldInput` gets a `type === 'date'` branch
   rendering `<input type="date">` (value is the plain `yyyy-mm-dd` string, so
   the existing string-valued autosave path works unchanged).
3. **`jobDueDateChip.ts`** (new, mirrors `jobPeriodChip.ts`) — pure formatter:
   `formatJobDueDateChip({ due, completed }, today)` returns
   `{ label, tooltip, tone } | null`:
   - `null` when `due` is missing/unparsable.
   - `label` = `dd/MM` (chip also renders a small clock icon), `tooltip` =
     localized "Delivery due dd/MM/yyyy".
   - `tone`: `'overdue'` (past due) / `'due-soon'` (≤ 7 days) / `'ok'`.
   - When `completed` is set, tone is forced to `'ok'` (a done job never shows
     a red overdue chip).
4. **`JobsKanbanCard.tsx`** — render the chip in the top chip row (after the
   billing period chip) whenever `job.details?.due_date` exists — effectively
   web_dev cards only, since only web_dev has the field. Tones: overdue →
   red bg, due-soon → amber bg, ok → muted gray bg (distinct from the billing
   chip's green "ok" state).

## Testing (TDD)

- `jobDueDateChip.test.ts` — overdue / due-soon boundary (7 days) / ok /
  missing / invalid date / completed-suppresses-urgency.
- `serviceInfoFields.test.ts` — web_dev list includes the `due_date` date
  field; not shared with deal.
- `JobInfoPanel.test.tsx` — date field renders an `<input type="date">` and
  participates in autosave values.

## Out of scope (YAGNI)

- No board sorting/filtering by due date.
- No due-date column on hosting/maintenance/domains list pages or the client
  Jobs tab.
- No notifications or reminder emails.
- No header display on the job detail page.

## Changes / Revert

- Frontend-only; no migrations, no RPC changes, no data backfill.
- Revert = `git revert` of the implementation commit(s). Any `due_date` keys
  already saved in `jobs.details` are inert leftovers (nothing reads them
  after revert) and may be left in place.
