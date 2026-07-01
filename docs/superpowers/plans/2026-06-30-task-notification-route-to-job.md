# Task Notifications → Service Job (not Deal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `task_assigned` / `task_resolved` notifications to the matching service JOB (e.g. `/jobs/<id>?tab=tasks&open=assigned:<task_id>`) instead of the parent deal, so dept users (web_seo / local_seo / web_dev / social_media) who lack deal-level RLS access can actually open their task.

**Architecture:**
1. The `assigned_tasks` notify triggers compute a `target_job_id` at insert/update time and stash it in the notification `payload`. For `parent_type='job'` rows it's just `new.job_id`. For `parent_type='deal'` rows with a `department_group_id`, it looks up the deal's job whose `service_type` equals the group's `code` (so a "web_seo" dept task on a deal lands on that deal's web_seo job — including the AI SEO child since the child carries `service_type='web_seo'`).
2. `readPath()` in `notification-presenters.tsx` prefers `payload.target_job_id` over the existing `/tasks?open=...` fallback and emits `/jobs/<id>?tab=tasks&open=assigned:<task_id>`. Pure logic + tests already in place.
3. `JobDetailPage` parses `?tab=tasks` (controlled Tabs `value`) and `?open=assigned:<id>` (forwarded into `AssignedTasksTab` via a new `initialOpenTaskId` prop), then strips both query params via `setSearchParams(..., { replace: true })`. This mirrors the b4df001 pattern in `TasksKanbanBoard.tsx:68–85`.

**Tech Stack:** Postgres (Supabase) trigger functions, React 18 + React Router v6 `useSearchParams`, Vitest unit tests, shadcn/ui `Tabs`.

**Scope:**
- IN: `task_assigned` and `task_resolved` notifications (both fire from `assigned_tasks` table triggers).
- IN: user_tasks `task_resolved` notifications stay on `/tasks` (personal tasks have no deal/job — no change to `20260622280000_user_tasks_notify_creator.sql`).
- OUT: mention / task_comment / task_started / payment_overdue notification routing — unchanged.
- OUT: changing where the task is *created* — only the post-create notification routing changes.

**Changes / Revert:**
- New migration: `supabase/migrations/20260630000000_task_notif_target_job.sql` — replaces both trigger functions and backfills unread `task_assigned` / `task_resolved` notifications. Rollback SQL is included at the bottom of the migration (restores prior trigger bodies — they're tiny; verbatim copy from `20260512000001_assigned_tasks.sql:108–177`).
- Frontend: `src/features/notifications/notification-presenters.tsx`, `src/features/notifications/notification-presenters.test.ts`, `src/features/jobs/JobDetailPage.tsx`, `src/features/assigned_tasks/AssignedTasksTab.tsx`. Pure additions; revert is a `git revert` of the commits.

---

### Task 1: SQL — add `target_job_id` to the trigger payload + backfill unread

**Files:**
- Create: `supabase/migrations/20260630000000_task_notif_target_job.sql`

Context: the current trigger bodies are at `supabase/migrations/20260512000001_assigned_tasks.sql:108–177`. They build the payload from `new.deal_id` / `new.job_id` only. We want them to additionally compute a `target_job_id`:
- If `new.job_id IS NOT NULL` → use it.
- Else if `new.deal_id IS NOT NULL AND new.department_group_id IS NOT NULL` → `SELECT j.id FROM jobs j JOIN groups g ON g.id = new.department_group_id WHERE j.deal_id = new.deal_id AND j.service_type = g.code ORDER BY j.created_at ASC LIMIT 1`. (ORDER BY is for determinism when a deal has two jobs of the same service_type — rare; oldest wins.)
- Else → NULL. The frontend falls back to `/tasks?open=assigned:<id>` which is RLS-safe for the assignee.

Edge cases that fall out naturally with this query (no special handling needed): AI SEO 3-row split — the parent has `service_type='ai_seo'` which never matches a `web_seo` / `local_seo` department code, so the child job (which carries the matching `service_type`) is what the JOIN finds.

- [ ] **Step 1: Create the migration file with new trigger bodies + backfill**

Create `supabase/migrations/20260630000000_task_notif_target_job.sql`:

```sql
-- =============================================================================
-- 20260630000000_task_notif_target_job.sql
-- Route task notifications to the matching service job so dept users (who lack
-- RLS access to the parent deal) can open them. Adds payload.target_job_id and
-- backfills unread task_assigned / task_resolved notifications.
-- =============================================================================

-- ---------- Helper: resolve a deal-task to its dept-matched job --------------
create or replace function public.task_target_job_id(
  p_deal_id uuid,
  p_job_id uuid,
  p_department_group_id uuid
) returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_job_id,
    (
      select j.id
      from public.jobs j
      join public.groups g on g.id = p_department_group_id
      where p_deal_id is not null
        and p_department_group_id is not null
        and j.deal_id = p_deal_id
        and j.service_type = g.code
      order by j.created_at asc
      limit 1
    )
  );
$$;

revoke all on function public.task_target_job_id(uuid, uuid, uuid) from public, anon;
grant execute on function public.task_target_job_id(uuid, uuid, uuid) to authenticated, service_role;

-- ---------- Replace the assignee-notify trigger ------------------------------
create or replace function public.assigned_tasks_notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
begin
  if new.assignee_user_id = new.created_by_user_id then
    return new;
  end if;
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  insert into public.notifications (user_id, type, payload)
  values (
    new.assignee_user_id,
    'task_assigned',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', v_parent_type,
      'parent_id', v_parent_id,
      'author_id', new.created_by_user_id,
      'title', new.title,
      'source_code', new.source_code,
      'target_job_id', v_target_job_id
    )
  );
  return new;
end $$;

-- ---------- Replace the creator-notify trigger -------------------------------
create or replace function public.assigned_tasks_notify_creator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  if new.created_by_user_id = coalesce(new.resolved_by_user_id, auth.uid()) then
    return new;
  end if;
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  insert into public.notifications (user_id, type, payload)
  values (
    new.created_by_user_id,
    'task_resolved',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', v_parent_type,
      'parent_id', v_parent_id,
      'author_id', coalesce(new.resolved_by_user_id, auth.uid()),
      'title', new.title,
      'source_code', new.source_code,
      'target_job_id', v_target_job_id
    )
  );
  return new;
end $$;

-- ---------- Backfill: add target_job_id to existing unread task notifs ------
-- Only unread (read_at is null) — already-read notifs don't need rerouting.
update public.notifications n
set payload = n.payload || jsonb_build_object('target_job_id', t.target_job_id)
from (
  select
    a.id as task_id,
    public.task_target_job_id(a.deal_id, a.job_id, a.department_group_id) as target_job_id
  from public.assigned_tasks a
) t
where n.read_at is null
  and n.type in ('task_assigned', 'task_resolved')
  and (n.payload ->> 'task_id')::uuid = t.task_id
  and t.target_job_id is not null
  and not (n.payload ? 'target_job_id');

-- =============================================================================
-- Revert SQL (apply manually to roll back):
-- =============================================================================
--   -- Restore prior trigger bodies from 20260512000001_assigned_tasks.sql:108–177
--   create or replace function public.assigned_tasks_notify_assignee() ...;  -- pre-patch body
--   create or replace function public.assigned_tasks_notify_creator()  ...;  -- pre-patch body
--   -- Strip the new payload key (idempotent):
--   update public.notifications
--      set payload = payload - 'target_job_id'
--    where type in ('task_assigned','task_resolved')
--      and payload ? 'target_job_id';
--   drop function if exists public.task_target_job_id(uuid, uuid, uuid);
```

- [ ] **Step 2: Apply the migration to prod**

Per memory `reference_supabase_mgmt_api.md` and the prod-DDL workflow in `project_job_codes.md`: DDL goes through the Supabase MCP, not the curl Management API (the safety classifier hard-blocks DDL via Bash). Run:

```text
mcp__plugin_supabase_supabase__apply_migration
  project_id: xujlrclyzxrvxszepquy
  name: task_notif_target_job
  query: <paste the migration body — everything before the "Revert SQL" comment block>
```

Expected: returns success / no rows. If the migration tool complains the file already exists, skip — the trigger replacement is idempotent.

- [ ] **Step 3: Verify the trigger payload via SQL**

Pick a recent open `assigned_tasks` row that has `deal_id IS NOT NULL` and `department_group_id IS NOT NULL` — ideally a `web_seo` or `local_seo` task on a deal that has the matching service job. Then:

Run via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
-- A: confirm the helper resolves to a real job
select
  a.id as task_id,
  a.deal_id,
  a.department_group_id,
  g.code as dept_code,
  public.task_target_job_id(a.deal_id, a.job_id, a.department_group_id) as target_job_id
from public.assigned_tasks a
join public.groups g on g.id = a.department_group_id
where a.deal_id is not null
  and a.department_group_id is not null
  and a.status = 'open'
limit 5;

-- B: confirm the backfill ran (sample unread notif payloads)
select id, type, payload ->> 'target_job_id' as target_job_id
from public.notifications
where type in ('task_assigned', 'task_resolved')
  and read_at is null
order by created_at desc
limit 10;
```

Expected:
- A: each row's `target_job_id` either matches a real `jobs.id` (when a matching service job exists on the deal) or is NULL (when no such job exists yet — fallback case).
- B: at least some recent unread task notifs have a non-null `target_job_id`.

- [ ] **Step 4: Smoke-create one live `assigned_task` row and confirm the new notif carries `target_job_id`**

Identify a deal with an active `web_seo` job and a user in the `web_seo` group (e.g. `pefstathiadis@itdev.gr` per `project_local_seo_owner.md`). Run via `execute_sql`:

```sql
with picked as (
  select
    d.id as deal_id,
    (select id from public.profiles where email = 'pefstathiadis@itdev.gr') as assignee,
    (select id from public.profiles where email = 'info@itdev.gr') as creator,
    (select id from public.groups where code = 'web_seo') as dept_group
  from public.deals d
  join public.jobs j on j.deal_id = d.id and j.service_type = 'web_seo'
  where d.archived = false
  limit 1
)
insert into public.assigned_tasks
  (deal_id, assignee_user_id, created_by_user_id, department_group_id, title, status, source_code)
select deal_id, assignee, creator, dept_group, 'smoke-test target_job_id ' || now()::text, 'open', 'web_seo'
from picked
returning id;

-- Fetch the just-created notification
select payload
from public.notifications
where type = 'task_assigned'
order by created_at desc
limit 1;
```

Expected: the latest `task_assigned` payload includes `"target_job_id": "<uuid>"` matching that deal's `web_seo` job. Clean up:

```sql
delete from public.assigned_tasks where title like 'smoke-test target_job_id %';
delete from public.notifications where payload ->> 'title' like 'smoke-test target_job_id %';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260630000000_task_notif_target_job.sql
git commit -m "feat(notifications): add target_job_id to task notif payload + backfill

Trigger now resolves a deal-task tagged with a department to that deal's
matching service job (groups.code = jobs.service_type) and stores it as
payload.target_job_id. Frontend will use this to deep-link dept users
who lack RLS access to the parent deal."
```

---

### Task 2: Frontend — `readPath()` prefers `target_job_id`

**Files:**
- Modify: `src/features/notifications/notification-presenters.test.ts` (add cases)
- Modify: `src/features/notifications/notification-presenters.tsx:12-42`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notifications/notification-presenters.test.ts` (just before the closing of the `describe('readPath — task routing', ...)` block):

```ts
  it('routes a task with target_job_id to /jobs/<id>?tab=tasks&open=assigned:<task_id>', () => {
    // The DB trigger fills target_job_id on dept-tagged deal tasks so dept users
    // (no RLS on the deal) can still open the task on their service job page.
    expect(
      readPath({
        task_id: 't10',
        parent_type: 'deal',
        parent_id: 'd10',
        target_job_id: 'j10',
      }),
    ).toBe('/jobs/j10?tab=tasks&open=assigned:t10');
  });
  it('prefers target_job_id over the /tasks fallback even when parent is a job', () => {
    expect(
      readPath({
        task_id: 't11',
        parent_type: 'job',
        parent_id: 'j11',
        target_job_id: 'j11',
      }),
    ).toBe('/jobs/j11?tab=tasks&open=assigned:t11');
  });
  it('uses user kind in the open key when target_job_id + task_kind=user_task (defensive — should not happen in practice)', () => {
    expect(
      readPath({
        task_id: 't12',
        task_kind: 'user_task',
        target_job_id: 'j12',
      }),
    ).toBe('/jobs/j12?tab=tasks&open=user:t12');
  });
  it('ignores a non-string target_job_id and falls back to the /tasks deep link', () => {
    expect(
      readPath({
        task_id: 't13',
        parent_type: 'deal',
        parent_id: 'd13',
        target_job_id: null,
      }),
    ).toBe('/tasks?open=assigned:t13');
  });
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/features/notifications/notification-presenters.test.ts
```

Expected: 4 new tests fail (the helper still returns `/tasks?open=...` regardless of `target_job_id`).

- [ ] **Step 3: Update `readPath()` to honour `target_job_id`**

In `src/features/notifications/notification-presenters.tsx`, replace the task-id branch (lines 15–22) with:

```tsx
  const taskId = payload['task_id'];
  if (typeof taskId === 'string') {
    const kind =
      payload['task_kind'] === 'user_task' || payload['parent_type'] === 'user_task'
        ? 'user'
        : 'assigned';
    const targetJobId = payload['target_job_id'];
    if (typeof targetJobId === 'string') {
      // Dept-tagged tasks: dept users lack RLS on the parent deal, so route
      // them to the matching service job that they DO have access to.
      // ?tab=tasks + ?open=<kind>:<id> mirrors the /tasks deep-link contract.
      return `/jobs/${targetJobId}?tab=tasks&open=${kind}:${taskId}`;
    }
    return `/tasks?open=${kind}:${taskId}`;
  }
```

(Update the file-top comment to describe the new behaviour too — keep it short. Replace lines 7–11 with: `// Route a notification to where the recipient can actually open it. Task // payloads with a target_job_id deep-link into /jobs/<id>?tab=tasks&open=… so // dept users (who lack RLS on the parent deal) can open the task on their // service job; otherwise fall back to /tasks?open=… which is RLS-safe for // the assignee.`)

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/features/notifications/notification-presenters.test.ts
```

Expected: all tests pass (previous 12 + the 4 new ones = 16 total).

- [ ] **Step 5: Run the strict build**

```bash
npm run build
```

Per `reference_build_strictness.md`, this is stricter than `tsc --noEmit` (catches `noUncheckedIndexedAccess` + eslint warnings). Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/notification-presenters.tsx src/features/notifications/notification-presenters.test.ts
git commit -m "feat(notifications): route dept tasks to /jobs/:id?tab=tasks&open=…

readPath now prefers payload.target_job_id (added by the assigned_tasks
trigger) over the /tasks fallback so dept users land on their service job,
which they have RLS access to."
```

---

### Task 3: `JobDetailPage` deep-link — `?tab=tasks` + `?open=assigned:<id>` auto-open the task dialog

**Files:**
- Modify: `src/features/assigned_tasks/AssignedTasksTab.tsx:98-179`
- Modify: `src/features/jobs/JobDetailPage.tsx:76-100, 347-358`

Context: `AssignedTasksTab` owns `openTaskId` internal state at line 105. The shadcn `Tabs` in `JobDetailPage.tsx:347` uses `defaultValue="overview"` (uncontrolled). We need to:
1. Add an `initialOpenTaskId?: string | null` prop on `AssignedTasksTab` that, when it changes from null/undefined to a string, sets internal `openTaskId` (one-shot apply).
2. In `JobDetailPage`, switch `Tabs` to controlled (`value` + `onValueChange`); seed `value` from `?tab=…` once.
3. Parse `?open=assigned:<id>` once and pass the id as `initialOpenTaskId`; then strip both params via `setSearchParams(next, { replace: true })`.

We deliberately only support `?open=assigned:<id>` here (job page never shows user_tasks).

- [ ] **Step 1: Add the `initialOpenTaskId` prop to `AssignedTasksTab`**

In `src/features/assigned_tasks/AssignedTasksTab.tsx`, find the `Props` type near the top (search for `type Props`). Add the optional prop:

```ts
type Props = {
  source: AssignedTaskSource;
  deptMatch?: { dealId: string; departmentGroupId: string };
  initialOpenTaskId?: string | null;
};
```

Then in the `AssignedTasksTab` function (around line 98), update the destructure and add a one-shot effect right after the existing `const [openTaskId, setOpenTaskId] = useState<string | null>(null);` (line 105):

```tsx
export function AssignedTasksTab({ source, deptMatch, initialOpenTaskId }: Props) {
  // ...existing hooks...
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Deep-link from a notification: open the requested task once on mount.
  // Notifications strip the query param after this fires (see JobDetailPage),
  // so this effect won't re-trigger on the next render.
  useEffect(() => {
    if (initialOpenTaskId && userId) {
      markOpened(userId, initialOpenTaskId);
      setOpenTaskId(initialOpenTaskId);
    }
  }, [initialOpenTaskId, userId, markOpened]);
```

Make sure `useEffect` is imported from React at the top of the file. (Search for the existing `import { useState }` and change to `import { useEffect, useState }`.)

- [ ] **Step 2: Add `?tab` and `?open` parsing in `JobDetailPage`**

In `src/features/jobs/JobDetailPage.tsx`, update the imports near line 2:

```tsx
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
```

And `import { useState }` (line 1) → `import { useEffect, useState } from 'react';`.

Inside `JobDetailPage()` (around line 100, just below the other state declarations), add:

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get('tab') ?? 'overview');
  const [initialOpenTaskId, setInitialOpenTaskId] = useState<string | null>(() => {
    const raw = searchParams.get('open');
    if (!raw) return null;
    const [kind, id] = raw.split(':');
    return kind === 'assigned' && id ? id : null;
  });

  // One-shot: strip ?tab + ?open after we've consumed them so closing the
  // tab/dialog doesn't bounce the user back to them on the next render.
  useEffect(() => {
    if (!searchParams.get('tab') && !searchParams.get('open')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
```

- [ ] **Step 3: Convert `<Tabs>` to controlled and forward `initialOpenTaskId`**

In `src/features/jobs/JobDetailPage.tsx` at line 347, change:

```tsx
      <Tabs defaultValue="overview" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
```

to:

```tsx
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
      >
```

Then at line 546 (inside `<TabsContent value="tasks">`), forward the prop:

```tsx
            <AssignedTasksTab
              source={{ kind: 'job', id: job.id }}
              initialOpenTaskId={initialOpenTaskId}
              {...(groupIdForServiceType(groups, job.service_type)
                ? {
                    deptMatch: {
                      dealId: job.deal_id,
                      departmentGroupId: groupIdForServiceType(groups, job.service_type)!,
                    },
                  }
                : {})}
            />
```

(Note: passing `initialOpenTaskId={null}` is fine — the effect in Task 3 Step 1 short-circuits on falsy values.)

- [ ] **Step 4: Run the strict build**

```bash
npm run build
```

Expected: green. Common failure: `exactOptionalPropertyTypes` may complain about `initialOpenTaskId?: string | null` — if so, change the prop type to `initialOpenTaskId?: string` and conditionally spread it: `{...(initialOpenTaskId ? { initialOpenTaskId } : {})}` at the call site (mirrors the existing `deptMatch` spread on the same call). Or accept `string | null | undefined` and keep passing `null` — pick whichever the compiler accepts.

- [ ] **Step 5: Live smoke test the deep-link**

Pick a real `assigned_tasks` row whose `deal_id IS NOT NULL`, `department_group_id IS NOT NULL`, and whose deal has a matching service job. Note its `task_id` and the resolved `target_job_id` from Task 1 Step 3 query A.

Open in a browser (logged in as an admin so RLS isn't a confounder for the first pass):

```
https://www.itdevcrm.com/jobs/<target_job_id>?tab=tasks&open=assigned:<task_id>
```

Expected: page loads → Tasks tab is active (not Overview) → Assigned Task Detail dialog pops automatically with the right task → URL bar shows `/jobs/<target_job_id>` with the query params stripped → closing the dialog leaves you on the Tasks tab (does NOT reopen).

If the dialog doesn't pop, check the React DevTools: `AssignedTasksTab` should receive `initialOpenTaskId="<task_id>"` once and the effect should have run.

- [ ] **Step 6: Commit**

```bash
git add src/features/assigned_tasks/AssignedTasksTab.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): deep-link ?tab=tasks&open=assigned:<id> on /jobs/:id

JobDetailPage now reads ?tab + ?open once on mount, opens the Assigned
Task dialog via a new initialOpenTaskId prop on AssignedTasksTab, and
strips both params so the dialog doesn't re-open on close. Mirrors the
b4df001 pattern used on /tasks. Notification readPath now lands dept
users here instead of /tasks."
```

---

### Task 4: End-to-end smoke test on production

**Files:** (none — verification only)

- [ ] **Step 1: Push and wait for Vercel deploy**

```bash
git push origin main
```

Wait until the Vercel deploy goes green (check `https://www.itdevcrm.com` is serving the new bundle — hard refresh).

- [ ] **Step 2: Create a real task and follow the notification path**

In a fresh logged-in tab as admin (`info@itdev.gr`):

1. Open a deal that has a `web_seo` job (any active deal you know has one).
2. On that deal's Tasks tab, create an assigned task: pick a `web_seo` dept user (e.g. `pefstathiadis@itdev.gr`) as the assignee, tag department = `web_seo`, give it a title like `smoke 2026-06-30 dept routing`.
3. Open a second browser profile and log in as `pefstathiadis@itdev.gr`.
4. Open the notification bell.
5. Click the new `task_assigned` notification.

Expected: lands on `/jobs/<id>?tab=tasks&open=assigned:<task_id>` (URL params then stripped) → the task detail dialog is open → the user is **not** bounced to the deal (which they have no RLS access to). Per `reference_detail_page_void.md`, sanity-check there's no black void on the page.

- [ ] **Step 3: Verify the legacy `/tasks` fallback still works**

Find or create an `assigned_task` with `deal_id IS NULL` AND `job_id IS NULL` (rare but the constraint allows it for legacy rows — if you can't find one, skip this step). Click its notification. Expected: still lands on `/tasks?open=assigned:<task_id>` because the helper returns NULL (no parent to resolve).

- [ ] **Step 4: Save the memory update**

After verifying live, update memory file `project_dept_task_on_service_job.md` (or create a new one) with a one-line note: "2026-06-30: dept task notifications now route to the matching service JOB (target_job_id payload + readPath + JobDetailPage ?tab/?open). Migration 20260630000000."

Also update `MEMORY.md` to add or replace the one-line index entry pointing at it.

- [ ] **Step 5: Rotate any chat-shared Supabase token**

Per `project_admin_delete_lead.md` and other recent memory entries: if this session leaked an `sbp_…` Supabase token via MCP/Bash, ask the user to rotate it.

---

## Self-Review

**1. Spec coverage:**
- "Notification on a deal-tagged-to-dept task → routes to the job, not the deal" — Task 1 fills `target_job_id`, Task 2 routes on it, Task 3 makes the job page open the dialog.
- "Users without deal access can still see it" — `target_job_id` is computed at trigger time (no RLS in the trigger; `security definer`), the frontend just reads a URL; the job page itself uses existing assigned_tasks RLS which already lets the assignee in.
- "Auto-open the task dialog on the job" — Task 3 Step 1–3 forward `initialOpenTaskId` and AssignedTasksTab's existing dialog opens it.

**2. Placeholder scan:** no TBD / "add validation" / "similar to Task N" / "implement later" remain.

**3. Type consistency:** `target_job_id` (snake) is the payload key end-to-end; `initialOpenTaskId` (camel) is the React prop; `task_target_job_id(uuid, uuid, uuid)` is the SQL helper signature. `readPath` keeps its `NotifPayload` shape. `AssignedTasksTab` Props gains exactly one optional field.

**4. Memory caveats applied:** Build is verified with `npm run build` (not `tsc --noEmit`); DDL goes through Supabase MCP (not Bash curl); rollback SQL is included; no literal secrets in this doc.
