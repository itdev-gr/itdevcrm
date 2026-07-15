# Client tasks on deal + job — Phase 2 (deal/job targeting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a home-page task optionally target a specific deal/job of the chosen client, and scope its surfacing accordingly — keeping it a calendar `user_task`.

**Architecture:** Additive migration adds nullable `user_tasks.deal_id`/`job_id`. `TaskDialog` (client mode) gains cascading Deal/Job `<select>`s (reusing `useJobsForDeal`, new `useClientDealOptions`); `useUpsertTask` persists them. The deal/job surfacing (`useClientUserTasks`) becomes source-aware via a pure `filterUserTasksForSource`: a task shows on its target's tab, while untargeted (client-level) tasks still show on all the client's deals/jobs.

**Tech Stack:** React + TS, react-query, Supabase JS/Postgres, react-i18next, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-client-tasks-on-deal-job-design.md`. Builds on shipped Phase 1.
- Build gate strict (`tsc -b && npm run lint && vite build`, eslint max-warnings=0).
- Do NOT run full `vitest`; run only new/edited test files with `npx vitest run <path>`.
- Migration is additive + reversible (rollback SQL in-file). Apply to prod via Supabase MCP.
- Surfacing rule: **deal tab** shows rows where `(deal_id IS NULL AND job_id IS NULL)` OR `deal_id = <dealId>`; **job tab** shows `(deal_id IS NULL AND job_id IS NULL)` OR `job_id = <jobId>`. Setting a job also sets its parent `deal_id` (so a job-targeted task also appears on the deal, mirroring assigned_tasks).

---

### Task A: Migration + types

**Files:**
- Create: `supabase/migrations/20260715120000_user_tasks_deal_job.sql`
- Modify: `src/types/supabase.ts` (user_tasks Row/Insert/Update + Relationships)

- [ ] **Step 1: Write the migration**

```sql
-- user_tasks: optional deal/job target (keeps the task a calendar user_task).
alter table public.user_tasks
  add column if not exists deal_id uuid references public.deals(id) on delete set null,
  add column if not exists job_id  uuid references public.jobs(id)  on delete set null;

create index if not exists user_tasks_deal_id on public.user_tasks (deal_id) where deal_id is not null;
create index if not exists user_tasks_job_id  on public.user_tasks (job_id)  where job_id  is not null;

-- Rollback:
-- drop index if exists user_tasks_job_id;
-- drop index if exists user_tasks_deal_id;
-- alter table public.user_tasks drop column if exists job_id, drop column if exists deal_id;
```

- [ ] **Step 2: Apply to prod** via Supabase MCP `apply_migration` (name `user_tasks_deal_job`, project `xujlrclyzxrvxszepquy`). Verify columns exist with a follow-up `execute_sql` on `information_schema.columns`.

- [ ] **Step 3: Patch `src/types/supabase.ts`** — add to user_tasks `Row`, `Insert`, `Update` (all `?` for Insert/Update): `deal_id: string | null` and `job_id: string | null`; add two Relationships entries (`user_tasks_deal_id_fkey` → deals.id, `user_tasks_job_id_fkey` → jobs.id).

- [ ] **Step 4: Build + commit**

`npm run build` green →
```bash
git add supabase/migrations/20260715120000_user_tasks_deal_job.sql src/types/supabase.ts
git commit -m "feat(tasks): user_tasks.deal_id/job_id migration + types"
```

---

### Task B: Source-aware surfacing

**Files:**
- Modify: `src/features/tasks/useClientUserTasks.ts` (+ `.test.ts`)
- Modify: `src/features/tasks/ClientLinkedTasksSection.tsx`
- Modify: `src/features/assigned_tasks/AssignedTasksTab.tsx`

**Interfaces:**
- Produces: `filterUserTasksForSource(rows: UserTaskRow[], source: { kind: 'deal' | 'job'; id: string }): UserTaskRow[]`; `useClientUserTasks(clientId, meId, source)`.

- [ ] **Step 1: Failing test** for `filterUserTasksForSource` (client-level row shows on both; deal-targeted shows on its deal only; job-targeted shows on its job).
- [ ] **Step 2: Implement** `filterUserTasksForSource`; thread it into `useClientUserTasks` (fetch by client_id, filter by source before mapping); query key includes `source.kind`+`source.id`.
- [ ] **Step 3:** `ClientLinkedTasksSection` accepts `source`; `AssignedTasksTab` passes `source` (already in scope).
- [ ] **Step 4:** run test + `npm run build`; commit.

---

### Task C: Dialog pickers + persistence

**Files:**
- Modify: `src/features/home/hooks/useUpsertTask.ts` (Input + payload: deal_id/job_id)
- Create: `src/features/deals/hooks/useClientDealOptions.ts`
- Modify: `src/features/home/TaskDialog.tsx` (state, reset, Deal/Job selects, onSave)
- Modify: `src/i18n/locales/{en,el}/home.json` (deal/job picker labels)

- [ ] **Step 1:** `useUpsertTask` Input gains `deal_id?`/`job_id?`; payload spreads them (same `!== undefined` guard pattern).
- [ ] **Step 2:** `useClientDealOptions(clientId)` selects `id, code, title` from deals by client_id.
- [ ] **Step 3:** `TaskDialog` client mode: `dealId`/`jobId` state; reset from `task`/cleared on client change; Deal `<select>` (client's deals) + Job `<select>` (selected deal's jobs via `useJobsForDeal`); onSave sets `deal_id`/`job_id` (job → also its deal). Clearing the client clears both.
- [ ] **Step 4:** i18n labels; `npm run build`; commit.

---

## Live smoke (after Task C)
Create a home-page task, pick a client, pick that client's deal + a job → save. Open the job → Tasks tab shows it in "From this client"; open the parent deal → shows it; open a *different* deal of the same client → NOT shown (targeted). A client-only task (no deal/job) still shows on all the client's deals/jobs. 0 console errors.

## Changes / Revert
Migration (rollback SQL in-file) + `git revert` of the frontend commits. Additive throughout.
