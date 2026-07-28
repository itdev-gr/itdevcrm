# Support board → hosting-style list view

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation

## Goal

The Support board (`maintenance` service, `/tech/maintenance`) must look and behave
the same as the Hosting page: a flat table with Active/Done status instead of the
current 8-column kanban.

## Current state

- **Hosting** (`/tech/hosting`): `HostingListPage` — search box (client / domain /
  code), Active / Done / All filter pills, count, table with
  Client · Domain · Renewal due · Status, sorted by `period_due_date` asc (nulls
  last). Status dropdown flips the job between the `active` and `closed` stages
  (`closed` is terminal `completed`, so the ✓ flag is stamped/cleared).
- **Support** (`/tech/maintenance`): `JobsKanbanPage serviceType="maintenance"` —
  8 stages (onboarding, renewal, audit_strategy, active, done, on_hold, cancelled,
  closed) plus a virtual **Blocked** column (`maintenance` is in
  `BLOCKED_COLUMN_BOARDS`; hosting is exempt from payment blocks).

## Decisions (owner-approved)

1. **Kanban replaced completely.** `/tech/maintenance` renders the list; no toggle.
   The 8 `pipeline_stages` rows stay in the DB — revert = restore one router line.
2. **Status collapse.** Stage `closed` **or** the non-terminal `done` → shows
   **Done**; every other stage → **Active**. Dropdown writes: Active → `active`
   stage, Done → `closed` stage (with `completed: true`), identical to hosting.
3. **Blocked jobs: red chip, admin override.** A blocked job (`is_blocked`) shows a
   red **Blocked** chip in the Status column and is listed under the Active filter.
   - Non-admins: read-only chip.
   - Admins: the chip is a dropdown (Blocked / Active / Done). Active → existing
     `unblock_job` RPC; Done → `unblock_job` then move to `closed`.
   - Tooltip caveat: if the payment is still overdue, the nightly billing run
     re-blocks the job — manual unblock is a temporary release (same semantics as
     the Job detail page's existing unblock button).
   - No new RPC: `unblock_job` already gates on admin OR accounting-edit
     (migration `20260504000001_jobs_blocked_state.sql`).
4. **Shared component.** Extract one generic list component so Hosting and Support
   can never drift apart visually; both pages become thin wrappers.

## Architecture

- `src/features/jobs/JobsListPage.tsx` (new) — generic hosting-style list.
  Props: `serviceType`, `board`, `title`, `description`, `dueColumnLabel`,
  `doneStageCodes` (set), `showBlocked` (bool). Renders the exact current
  hosting markup. Uses existing `useJobs`, `usePipelineStages`, `useMoveJobStage`,
  `useUnblockJob`.
- `src/features/jobs/jobsList.ts` (new) — pure helpers generalised from
  `hosting/hostingList.ts`: `jobListStatus(job, doneStageIds)` (adds `blocked`),
  `jobListDomain(job)` (details.live_url → details.hosting → client.website),
  `filterAndSortJobsList(jobs, opts)`.
- `src/features/hosting/HostingListPage.tsx` — becomes a thin wrapper
  (`showBlocked=false`, `doneStageCodes={'closed'}`, label "Renewal due").
  `hostingList.ts` + its test are superseded by `jobsList.ts` (old files removed).
- `src/features/support/SupportListPage.tsx` (new) — thin wrapper
  (`serviceType="maintenance"`, `showBlocked=true`,
  `doneStageCodes={'done','closed'}`, label "Next due").
- `src/app/router.tsx` — `/tech/maintenance` → `SupportListPage` (lazy, like
  hosting). Everything else (sidebar, `/tech/maintenance/clients`, docs route)
  unchanged.

## Out of scope

- No DB changes of any kind (stages, RLS, RPCs untouched).
- No mine/group scope toggle (hosting has none; list shows all board jobs).
- Kanban sort preference (`SORT_ENABLED_BOARDS`) becomes unused for
  maintenance; left as-is.

## Error handling

Same as hosting today: stage move failures surface via the mutation's error path
(optimistic update reverts); unblock failures show the RPC error message.

## Testing

- `jobsList.test.ts` — status derivation (closed→done, done→done, blocked flag,
  doneStageIds precedence), domain fallback chain, filter by status/search,
  sort by due date nulls-last. Pure functions only (vitest hits prod — no DB tests).
- Existing `hostingList.test.ts` assertions migrate into the new test file.
- Manual smoke: /tech/hosting unchanged; /tech/maintenance lists jobs, flips
  status, admin sees Blocked dropdown, non-admin sees read-only chip.

## Changes / Revert

- Purely frontend; atomic commit(s) on `main`.
- Revert: `git revert` the commit(s) — restores kanban route and hosting page.
  No rollback SQL needed (zero DB changes).
