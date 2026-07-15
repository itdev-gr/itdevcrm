# Client home-page tasks surface on the deal + job

**Date:** 2026-07-15
**Status:** DRAFT — awaiting product-owner review (approach = "Both"; behavior + Phase 2 friction flagged below)

## Problem

The home page has two "New task" buttons (the calendar's, and the "Assigned to me"
widget's). Both open the same `TaskDialog`, whose client picker (`mode='client'`)
inserts a **`user_tasks`** row with `client_id` set and `lead_id` NULL. `user_tasks`
has **no `deal_id`/`job_id` columns** — so the task is linked only to the client.

The **deal** and **job** detail "Tasks" tabs both render `AssignedTasksTab` →
`useAssignedTasksForSource`, which reads **only `assigned_tasks`**, filtered strictly
by `deal_id`/`job_id` (never `client_id`, never `user_tasks`). Result: a task created
by picking a client on the home page **never appears on that client's deal or job** —
it surfaces only on the Client detail page's Tasks tab (`useClientTasks`, the one place
that reads `user_tasks` by `client_id`).

This is a design gap, not a broken query. The two task systems were deliberately kept
separate; the [dept-task-on-service-job spec (2026-06-26)] even listed *"Surfacing tasks
created from the client page / global new-task that aren't on a deal"* as explicitly
out of scope. This spec closes that gap.

### Live evidence (prod smoke test, 2026-07-15)

- **32** `user_tasks` rows have `client_id` set; **5 are still open**.
- **32/32** belong to a client that has ≥1 deal; **30/32** to a client that has ≥1 job.
- Example open task *"esd NA TON PAREIS…"* on client *ΒΑΣΗ ΝΟΜΙΚΩΝ… (Ο ΣΟΛΩΝ)* —
  the client has 1 deal + 1 job, yet the task shows nowhere on that deal/job today.
- Most affected clients have exactly **1 deal + 1 job**, so "show on the deal + job"
  is unambiguous for the common case (a few clients, e.g. Casa di Gusto, have 4 jobs).

## Grounding (current code)

- **Write:** `src/features/home/TaskDialog.tsx` (client picker at ~L192; payload at
  L104–115) → `src/features/home/hooks/useUpsertTask.ts` (L28–55) inserts into
  `user_tasks` with `client_id`, `lead_id:null`. `taskDialogRules.ts` decides
  client-vs-lead mode (sales default = lead; everyone else = client).
- **Read (deal & job):** `AssignedTasksTab` → `useAssignedTasksForSource.ts`
  - deal: `deal_id.eq.<id>` OR `job_id.in.(<deal's jobs>)`
  - job: `job_id.eq.<id>` (+ optional `and(deal_id.eq,department_group_id.eq)` deptMatch)
  - Never queries `user_tasks`, never filters by `client_id`.
- **Read (client):** `useClientTasks.ts` unions `user_tasks` **and** `assigned_tasks`,
  both `.eq('client_id', clientId)` — the only place a client `user_task` shows today.
- **Schema:** `user_tasks(id, user_id, title, notes, due_at, completed_at, importance,
  created_by, client_id?, lead_id?, started_at)` — **no `deal_id`/`job_id`**.
  `assigned_tasks(deal_id XOR job_id, client_id NOT NULL, department_group_id NOT NULL,
  assignee_user_id, status open|resolved, importance, …)` — **no `due_at`**.
- **Relationships:** `deals.client_id` → clients; `jobs.deal_id` → deals and
  `jobs.client_id` (denormalized) → clients.
- **Reusable pieces already built** (client-linked-tasks work): `ClientPicker`,
  `useClientSearch`, `UserTaskDetailDialog` (view + Resolve/Reopen), `ClientTasksTab`,
  `taskCard.ts` union model. Precedent for read-side surfacing + a "from …" chip:
  `serviceTaskMatch.ts` + `deptMatch` in `useAssignedTasksForSource`.

## Decisions

Product owner selected **"Both"**: (1) surface existing client tasks on the deal/job
tabs (read-side — fixes the 32 stranded tasks), **and** (2) let the home-page dialog
optionally target a specific deal/job. Split into two independently-shippable phases;
**Phase 1 alone already resolves the reported bug.**

### ⚠ Two points flagged for owner confirmation (chosen defaults below)

1. **Behavior of surfaced client rows (behavior question — left unanswered).**
   **Default:** surfaced client tasks render as read-only rows with a **"from client"**
   chip; clicking opens the existing `UserTaskDetailDialog` (which already supports
   Resolve/Reopen). This reuses existing code and needs **no new write path**, yet
   still lets staff view and complete the task from the deal/job. (Alternative — a
   fully inline complete checkbox on the deal/job row — can be added later; not needed.)

2. **RLS / visibility (important nuance).** `user_tasks` SELECT RLS =
   `auth.uid() = user_id OR auth.uid() = created_by OR is_admin`. So a surfaced client
   task is visible on the deal/job tab **only to its owner/creator and admins** — the
   same rule that already governs the client tab and the dept-task surfacing precedent.
   Teammates working the deal/job who are not the owner/admin still won't see it.
   **Default: leave RLS unchanged** (consistent, no data-model risk). If the intent is
   "everyone on the deal/job must see it," that's a separate decision (broaden
   `user_tasks` visibility, or use the Phase-2 deal/job target which is still `user_tasks`
   and therefore same RLS — so broadening would be a third, separate change).

3. **Phase 2 friction (why we do NOT write `assigned_tasks`).** The obvious "picker →
   `assigned_tasks`" route is a poor fit: `assigned_tasks` has **no `due_at`** (the
   home dialog is a due-date calendar task) and **requires `department_group_id`
   (NOT NULL)**. Converting would lose the due date and force a department choice.
   **Default for Phase 2:** add nullable `deal_id`/`job_id` to `user_tasks` and keep
   the task a calendar `user_task`; the read-side surfaces it by those FKs. One task
   system, due dates preserved, and it reuses Phase 1's plumbing.

---

## Design

### Phase 1 — Read-side surfacing of client `user_tasks` (no schema change)

Mirrors the dept-task pattern. The deal/job Tasks tabs additionally fetch the source's
client `user_tasks` and interleave them, badged "from client".

**1. Thread `clientId` to the tab.** `AssignedTasksTab` gains an optional
`clientId?: string`. `DealDetailPage` passes `deal.client_id`; `JobDetailPage` passes
`job.client_id`.

**2. Fetch client user-tasks.** New hook `useClientUserTasksForTab(clientId, enabled)`
querying `user_tasks` where `client_id = clientId` (open + resolved, matching the tab's
existing open/resolved handling). Kept as a **separate query** from
`useAssignedTasksForSource` (different table/shape) and cached under its own query key.

**3. Normalize + interleave.** Map each `user_task` to the tab's display row shape:
`status = completed_at ? 'resolved' : 'open'`, `importance`, owner = `user_id`, title,
plus a `source: 'client'` marker → renders a **"from client"** chip (mirroring the
"deal" chip). These rows are **read-only** in the tab; the whole row is clickable and
opens `UserTaskDetailDialog` (view + Resolve/Reopen).

**4. Result.** On the deal tab, every open/resolved client task appears (client-level,
so it shows on each of the client's deals). On the job tab likewise (each of the
client's jobs). RLS unchanged (see decision 2).

*Phase 1 is fully shippable on its own and fixes the 32 stranded tasks.*

### Phase 2 — Optional deal/job target in the home-page dialog

**A. Schema — `user_tasks.deal_id`, `user_tasks.job_id`** (migration
`20260715xxxxxx_user_tasks_deal_job.sql`):
```sql
alter table public.user_tasks
  add column deal_id uuid references public.deals(id) on delete set null,
  add column job_id  uuid references public.jobs(id)  on delete set null;
create index user_tasks_deal_id on public.user_tasks(deal_id) where deal_id is not null;
create index user_tasks_job_id  on public.user_tasks(job_id)  where job_id  is not null;
-- rollback: drop index user_tasks_job_id; drop index user_tasks_deal_id;
--           alter table public.user_tasks drop column job_id, drop column deal_id;
```
Regenerate/patch `src/types/supabase.ts`.

**B. TaskDialog cascading sub-pickers (client mode only).** After a client is chosen,
show optional **Deal** and **Job** dropdowns:
- Deal list = that client's deals (`deals` where `client_id`); reuse an existing
  client-deals hook if present, else a small `useClientDeals(clientId)`.
- Job list = the selected deal's jobs (`jobs` where `deal_id`), or the client's jobs
  when no deal is picked; small `useDealJobs(dealId)` / reuse.
- Picking a job auto-sets its `deal_id`. Both optional; clearing reverts to client-only.
`useUpsertTask` persists `deal_id`/`job_id` (nullable) alongside `client_id`. Still a
`user_task` (keeps `due_at`).

**C. Extend Phase-1 read-side to key on the new FKs.** `useClientUserTasksForTab`
becomes source-aware:
- **Deal tab:** `deal_id = dealId` (deal-specific) **OR** `job_id in (deal's jobs)`
  (job-specific under this deal) **OR** (`client_id = dealClientId` AND `deal_id is null`
  AND `job_id is null`) (client-level). Mirrors the assigned_tasks deal-tab union.
- **Job tab:** `job_id = jobId` (job-specific) **OR** (`client_id = jobClientId` AND
  `deal_id is null` AND `job_id is null`) (client-level).
Chips: client-level → "from client"; deal-specific shown on a job → "from deal"
(optional); job/deal-specific on their own tab → no chip (native).

*Phase 2 needs Phase 1's rendering; ship Phase 1 first.*

### i18n
`common.json` (en + el): "from client" chip; Phase 2 Deal/Job picker labels/placeholders.

## Testing (TDD, small commits per task)

**Phase 1**
- Unit: user_task → tab-row normalizer (open/resolved, importance, "from client" marker).
- Hook: `useClientUserTasksForTab` filters by `client_id`; disabled when no `clientId`.
- Interleave: client rows render with the chip and are read-only; click opens
  `UserTaskDetailDialog`; assigned rows unaffected.
- `npm run build` green.
- **Live smoke:** on the example client (1 deal + 1 job) the open home-page task now
  appears on both the deal and the job Tasks tab with a "from client" chip; clicking
  opens the detail dialog; resolving there clears it. 0 console errors.

**Phase 2**
- Migration applied via Supabase MCP (DDL); verify columns + indexes + round-trip.
- TaskDialog cascading pickers: deal list scoped to client, job list scoped to deal,
  job auto-fills deal; `useUpsertTask` sends `deal_id`/`job_id`.
- Read-side union: deal-specific / job-specific / client-level each land on the right
  tab with the right chip.
- **Live smoke:** create a task targeting a specific job → appears on that job (no chip)
  and its parent deal; a client-only task still appears on all the client's deals/jobs.

## Changes / Revert

**Phase 1 (no migration)** — new `useClientUserTasksForTab` + row normalizer; edits to
`AssignedTasksTab` (clientId prop, interleave + "from client" chip, open
`UserTaskDetailDialog`), `DealDetailPage`/`JobDetailPage` (pass client_id), i18n.
Revert = `git revert` the commits; purely additive read-side.

**Phase 2** — migration (`user_tasks.deal_id/job_id` + indexes; rollback SQL in-file);
edits to `TaskDialog`, `useUpsertTask`, new `useClientDeals`/`useDealJobs` (or reuse),
`useClientUserTasksForTab` (FK-aware union), `src/types/supabase.ts`, i18n. Atomic
commits per task; revert = git revert + rollback migration.

## Out of scope (YAGNI)

- Writing `assigned_tasks` from the home dialog (loses `due_at`, forces a department).
- Broadening `user_tasks` RLS so non-owners see surfaced client tasks (separate decision).
- A fully inline complete-checkbox on the deal/job row (click-through dialog suffices).
- Lead-linked home tasks surfacing anywhere new (this spec is client → deal/job only).
