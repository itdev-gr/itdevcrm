# Department tasks surface on the matching service job

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Problem

A delegated task (`assigned_tasks`) created on a **deal** stores `deal_id` + a
**department** (`department_group_id`, e.g. the `web_seo` group). The job detail
page's Tasks tab only queries `.eq('job_id', thisJobId)`, so a task tagged "web_seo
department" on deal 0583 shows on the deal but **never on 0583's Web SEO job**. The
Web SEO team doesn't see it where they work (the job).

Department group codes (`web_seo`, `local_seo`, `web_dev`, `social_media`) map 1:1 to
a job's `service_type`, so a department deterministically identifies a service job.

## Scope & decisions (confirmed with product owner)

- **Match by department → service.** A task whose `department_group_id` is the group
  for service `X`, on a deal that has an `X` job, also surfaces on that `X` job.
  Other-service jobs of the same deal are unaffected (each pulls only its own dept).
- **Read-side only — no schema/RLS/trigger change.** The job *reads* matching deal
  tasks; the task stays `deal_id`-scoped. (Rejected: relaxing the `deal_id`/`job_id`
  XOR constraint or a job_id-stamping trigger — both touch the task data model and the
  populate-source / notification triggers that branch on deal-vs-job.)
- **Two surfaces:** the job's **Tasks tab** (full list) and a **count badge** on the
  job's kanban card.
- **Covers deal-created department tasks** (the confirmed case), plus any job-scoped
  tasks already on the job. NOT a new "allocate from anywhere" flow.
- **RLS unchanged.** Both surfaces show what the viewer is already permitted to see
  (assignee/creator, or everything for admins) — so the badge count stays consistent
  with the tab.

## Grounding (current code)

- `assigned_tasks`: `deal_id` XOR `job_id`, `department_group_id` (NOT NULL, FK groups),
  `client_id`, `status` ('open'|'resolved'). Select via `ASSIGNED_TASK_SELECT`
  (includes `deal_id`, `job_id`, `department_group_id`).
- Job tab: `JobDetailPage.tsx` renders `<AssignedTasksTab source={{kind:'job', id: job.id}}/>`;
  `useAssignedTasksForSource` does `.eq('job_id', id)`.
- `useGroups()` returns all groups (`id`, `code`, …); `groups.code === service_type`.
- Service boards render `JobsKanbanCard` per job; `JobsKanbanPage` loads the jobs.

## Design

### 1. Pure helpers (`src/features/jobs/serviceTaskMatch.ts` + test)

```ts
import type { Group } from '@/features/stages/...'; // shape: { id: string; code: string }

/** The department group id for a service_type, or null when none exists
 *  (ai_seo / hosting / ads have no department group). */
export function groupIdForServiceType(
  groups: { id: string; code: string }[],
  serviceType: string,
): string | null {
  return groups.find((g) => g.code === serviceType)?.id ?? null;
}

type CountRow = { deal_id: string | null; job_id: string | null; department_group_id: string | null };

/** From the board's open tasks, build per-deal (department-matched) and per-job
 *  (job-scoped) count maps. A card's count = byDeal[deal_id] + byJob[job_id]. */
export function buildTaskCountMaps(
  rows: CountRow[],
  serviceGroupId: string | null,
): { byDeal: Record<string, number>; byJob: Record<string, number> } {
  const byDeal: Record<string, number> = {};
  const byJob: Record<string, number> = {};
  for (const r of rows) {
    if (r.job_id) byJob[r.job_id] = (byJob[r.job_id] ?? 0) + 1;
    else if (r.deal_id && serviceGroupId && r.department_group_id === serviceGroupId) {
      byDeal[r.deal_id] = (byDeal[r.deal_id] ?? 0) + 1;
    }
  }
  return { byDeal, byJob };
}
```

(A job-scoped dept task has `job_id` set → counted via `byJob` only; a deal-scoped
dept task has `deal_id` set → `byDeal`. No double counting; mirrors the tab's union.)

### 2. Job Tasks tab union

`useAssignedTasksForSource(source, deptMatch?)` gains an optional
`deptMatch?: { dealId: string; departmentGroupId: string }`. When present (job
source), the query unions job-scoped + deal+department:

```ts
// PostgREST OR with a nested AND:
q = q.or(
  `job_id.eq.${source.id},and(deal_id.eq.${deptMatch.dealId},department_group_id.eq.${deptMatch.departmentGroupId})`,
);
```

(no `deptMatch` → existing `.eq(column, id)`.) The query key includes `deptMatch` so
deal/job/union variants cache separately.

`JobDetailPage.tsx` resolves the group via `useGroups()` +
`groupIdForServiceType(groups, job.service_type)` and passes
`deptMatch={{ dealId: job.deal_id, departmentGroupId }}` (omitted when the service has
no group). `AssignedTasksTab` threads `deptMatch` to the hook and, for rows where
`job_id == null` (deal-scoped), renders a small **"deal"** chip so it's clear the task
was inherited from the deal.

### 3. Kanban card badge

`useServiceTaskCounts(serviceGroupId: string | null)` — one cached, RLS-limited query
shared by every card on a board (enabled when there's a job board):

```ts
let q = supabase.from('assigned_tasks')
  .select('deal_id, job_id, department_group_id').eq('status', 'open');
q = serviceGroupId
  ? q.or(`department_group_id.eq.${serviceGroupId},job_id.not.is.null`)
  : q.not('job_id', 'is', null);
// → buildTaskCountMaps(rows, serviceGroupId)
```

`JobsKanbanCard` computes `serviceGroupId = groupIdForServiceType(groups, job.service_type)`,
reads the maps, and shows an amber count badge when
`(byDeal[job.deal_id] ?? 0) + (byJob[job.id] ?? 0) > 0` (title: "N open tasks"). All
cards on a board pass the same `serviceGroupId`, so the query caches once (no N+1).

### i18n
`common.json` (en/el): the "deal" chip label and the badge tooltip ("{{count}} open tasks").

## Error handling
- Service with no department group (ai_seo/hosting/ads): `groupIdForServiceType` →
  null → tab shows only job-scoped tasks; badge counts only job-scoped. No errors.
- Query errors surface via react-query as today; the badge simply shows nothing.

## Testing
- **Unit:** `serviceTaskMatch.test.ts` — `groupIdForServiceType` (match / no-match) and
  `buildTaskCountMaps` (deal-dept counted to byDeal only when group matches; job-scoped
  to byJob; mixed; empty; null serviceGroupId).
- `npm run build` green.
- **Live smoke:** on a real deal that has a Web SEO job, create a delegated task with
  department = Web SEO → it appears in that Web SEO job's Tasks tab (with a "deal" chip)
  and the job's kanban card badge increments; a Local SEO job of the same deal does NOT
  show it. Resolve/delete the smoke task after. 0 console errors.

## Changes / Revert

**Changes**
- New `serviceTaskMatch.ts` (+test), `useServiceTaskCounts.ts`.
- Edit `useAssignedTasksForSource.ts` (optional deptMatch), `AssignedTasksTab.tsx`
  (deptMatch + "deal" chip), `JobDetailPage.tsx` (resolve+pass deptMatch),
  `JobsKanbanCard.tsx` (badge), i18n.

**Revert**
- `git revert` the frontend commits. No migration, no data change — purely additive
  read-side queries + UI.

## Out of scope (YAGNI)
- Writing `job_id` onto deal tasks / relaxing the XOR constraint.
- A new "allocate task from anywhere" creation flow.
- Surfacing tasks created from the client page / global new-task that aren't on a deal.
- Opening `assigned_tasks` RLS (visibility stays per-party/admin).
