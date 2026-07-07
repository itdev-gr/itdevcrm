# Deal Tasks Visibility (admin + accounting) — Design

**Date:** 2026-07-07
**Status:** Designed (user away; recommended options assumed — deal+job tasks on the tab, comment threads stay private). Pending user spec review.

## Problem

"Admin and accounting must be able to see all the tasks that there is in a deal."

Current state (verified live):
- `assigned_tasks` SELECT RLS = assignee OR creator OR **admin** → **admins already see everything**; accounting members see only tasks they created or were assigned. On a deal's Tasks tab an accountant gets a partial (often empty) list.
- The deal Tasks tab (`AssignedTasksTab` → `useAssignedTasksForSource`, `kind:'deal'`) queries `assigned_tasks.eq(deal_id)` only — tasks on the deal's **jobs** never appear there for anyone.

## Decisions (assumed recommendations)

1. Deal Tasks tab shows **deal tasks + all tasks of the deal's jobs**, each job task labeled with its job.
2. Accounting sees **list + task details**; comment threads stay private to task parties + admins (unchanged `is_task_party`).

## Design

### 1. DB — one migration (RLS widening only)

- Recreate `assigned_tasks_select` policy adding one term:
  `... OR public.current_user_is_admin() OR public.current_user_in_group('accounting')`
  (helper `current_user_in_group(p_code)` already exists and is used elsewhere).
- **Unchanged:** `assigned_tasks` UPDATE/DELETE policies (accounting cannot resolve/edit others' tasks), `user_tasks` policies (personal tasks stay private), `task_comments` policies / `is_task_party` (threads stay parties+admin).
- Effect radius: accounting members can now *read* any assigned task wherever the app queries them (deal tab, job tab, client tab's assigned side, task detail dialog). The /tasks board and home widget stay "mine" for accounting because their fetches filter by assignee/creator client-side, and the "All team" toggle remains admin-only.
- Rollback: recreate the original policy (assignee/creator/admin only).

### 2. Frontend — deal Tasks tab includes job tasks

- `useAssignedTasksForSource`: for `kind:'deal'`, accept optional `jobIds: string[]` and query
  `.or('deal_id.eq.<id>, job_id.in.(<jobIds>)')` when jobIds is non-empty (single query, no dedupe needed — a task has either deal_id or job_id linkage rows returned once).
- `DealDetailPage` passes the deal's job ids + a `{jobId → job code/title}` map (jobs are already loaded on the page).
- `AssignedTasksTab`: job-linked tasks get a small chip with the job code (e.g. `005230-WEBSEO`) so it's clear where each task lives. Deal-level tasks render as today.
- Task detail dialog tweaks (visibility-driven, minimal):
  - Resolve button shows only for assignee / creator / admin (today it shows for anyone with the dialog open and lets RLS reject — with accounting now able to open any task, hide it for non-parties instead of surfacing an RLS error).
  - Comment composer hidden for non-parties (accounting sees a muted "visible to task participants" note instead; the thread itself returns no rows to them by RLS, unchanged).

### 3. Out of scope

- No change to `user_tasks` visibility (client tab's personal-task side stays as today).
- No change to who can create/resolve/comment.
- No /tasks board changes (the admin-only "All team" toggle stays admin-only).

## Testing

- **DB (rolled-back probes, role-switch technique):** impersonate an accounting member → sees another user's deal task; impersonate a sales rep (non-party) → still cannot; accounting UPDATE attempt on a foreign task → 0 rows.
- **Frontend (mocked):** hook builds the `.or()` with jobIds; job chip renders; Resolve hidden for non-party; composer hidden for non-party.
- `npm run build` strict gate; live smoke with a real accounting login on a deal that has both deal- and job-level tasks.

## Changes / Revert

**Changes:** 1 migration (recreate one SELECT policy) + ~4 frontend files (hook, tab, dialog, deal page) + tests.

**Revert:** migration ROLLBACK block restores the original policy; `git revert` for the frontend.
