# Task Collaboration (comments + "Started working") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task's creator and assignee converse on the task (comments) and let the assignee flag "Started working", with in-app notifications, on BOTH task tables (`user_tasks` + `assigned_tasks`), keeping visibility restricted to creator + assignee + admin.

**Architecture:** One additive migration: `started_at` columns + NULL→set notify triggers on both task tables, plus a dedicated `task_comments` table (NOT the shared open `comments` table) whose RLS is scoped to the task's parties via an `is_task_party()` helper, plus a comment-insert notify trigger and realtime. Frontend: a pure visibility module, three small hooks, two new components (`StartTaskButton`, `TaskComments`), edits to the two detail dialogs + the kanban card + the notification presenters.

**Tech Stack:** React + TypeScript (strict: `noUncheckedIndexedAccess`, eslint `--max-warnings=0`), @tanstack/react-query, supabase-js, @dnd-kit, vitest, Playwright. Prod Supabase project id `xujlrclyzxrvxszepquy` ("CRM"). DDL applied via Supabase MCP `apply_migration`.

**Spec:** `docs/superpowers/specs/2026-06-25-task-collaboration-design.md`

**Conventions confirmed from the codebase:**
- Admin SQL helper is `public.current_user_is_admin()` (NOT `is_admin()`).
- `user_tasks`: assignee = `user_id`, creator = `created_by` (nullable). `assigned_tasks`: assignee = `assignee_user_id`, creator = `created_by_user_id`; exactly one of `deal_id`/`job_id`.
- Notifications table: `public.notifications (user_id, type, payload jsonb, read_at, created_at)`. Triggers `insert into notifications (user_id, type, payload) values (...)`.
- Notification presenters render **English literal strings** (no i18n in the presenter); the notifications dropdown is already English-only in prod. New types match that (English literal). In-dialog/button strings ARE i18n'd (`common.json`, en + el).
- Current user id in components: `useAuthStore((s) => s.user?.id ?? '')`; admin: `useAuthStore((s) => s.isAdmin)`.
- Name resolution on the board uses `useMentionableUsers()` → `{ user_id, full_name, email }`; comment author names come from a joined profile on the query (same pattern as `useAssignedTaskDetail`'s `creator:created_by_user_id (...)`).
- `TaskCard.relation === 'mine'` means the viewer is the assignee.

---

## File Structure

**Created:**
- `supabase/migrations/20260625160000_task_collaboration.sql` — all DB changes.
- `src/features/tasks/taskStarted.ts` + `taskStarted.test.ts` — pure visibility rules.
- `src/features/tasks/StartTaskButton.tsx` — button/badge.
- `src/features/tasks/TaskComments.tsx` — thread + composer.
- `src/features/tasks/hooks/useStartTask.ts` — set `started_at`.
- `src/features/tasks/hooks/useTaskComments.ts` — query + realtime.
- `src/features/tasks/hooks/usePostTaskComment.ts` — insert comment.

**Modified:**
- `src/types/supabase.ts` — `started_at` on both task tables + `task_comments` table block.
- `src/lib/queryKeys.ts` — `taskComments` key.
- `src/features/tasks/taskCard.ts` — `startedAtIso` on `TaskCard` + both transformers.
- `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts` — `started_at` in `ASSIGNED_TASK_SELECT` + `AssignedTaskRow`.
- `src/features/assigned_tasks/hooks/useAssignedTaskDetail.ts` — `started_at` + `assignee` in SELECT/type.
- `src/features/tasks/UserTaskDetailDialog.tsx` — status line + start + comments.
- `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx` — status/importance/assignee + start + comments.
- `src/features/tasks/TaskKanbanCard.tsx` — "Started" badge.
- `src/features/notifications/notification-presenters.tsx` — `task_comment` + `task_started`.
- `src/i18n/locales/en/common.json` + `src/i18n/locales/el/common.json` — new `tasks_page.*` strings.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260625160000_task_collaboration.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260625160000_task_collaboration.sql
-- Task collaboration: started_at flag + dedicated task_comments table, both
-- scoped to the task's parties (creator + assignee + admin). Additive + reversible.

-- 1. started_at on both task tables.
alter table public.user_tasks     add column if not exists started_at timestamptz;
alter table public.assigned_tasks  add column if not exists started_at timestamptz;

-- 2. Notify the CREATOR when the assignee marks work started (NULL -> set).
create or replace function public.user_tasks_notify_started()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.started_at is null or old.started_at is not null then return new; end if;
  if new.created_by is null
     or new.created_by = new.user_id
     or new.created_by = auth.uid() then
    return new;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (new.created_by, 'task_started', jsonb_build_object(
    'task_kind', 'user_task',
    'task_id', new.id,
    'parent_type', 'user_task',
    'parent_id', new.id,
    'author_id', new.user_id,
    'title', new.title
  ));
  return new;
end $$;

drop trigger if exists user_tasks_notify_started on public.user_tasks;
create trigger user_tasks_notify_started
  after update of started_at on public.user_tasks
  for each row execute function public.user_tasks_notify_started();

create or replace function public.assigned_tasks_notify_started()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent_type text; v_parent_id uuid;
begin
  if new.started_at is null or old.started_at is not null then return new; end if;
  if new.created_by_user_id = new.assignee_user_id
     or new.created_by_user_id = auth.uid() then
    return new;
  end if;
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (new.created_by_user_id, 'task_started', jsonb_build_object(
    'task_kind', 'assigned_task',
    'task_id', new.id,
    'parent_type', v_parent_type,
    'parent_id', v_parent_id,
    'author_id', new.assignee_user_id,
    'title', new.title,
    'source_code', new.source_code
  ));
  return new;
end $$;

drop trigger if exists assigned_tasks_notify_started on public.assigned_tasks;
create trigger assigned_tasks_notify_started
  after update of started_at on public.assigned_tasks
  for each row execute function public.assigned_tasks_notify_started();

-- 3. Dedicated comments table, parties-only (NOT the open public.comments table).
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  user_task_id uuid references public.user_tasks(id) on delete cascade,
  assigned_task_id uuid references public.assigned_tasks(id) on delete cascade,
  author_user_id uuid not null references public.profiles(user_id),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  constraint task_comments_one_parent
    check ((user_task_id is not null) <> (assigned_task_id is not null))
);
create index if not exists task_comments_user_task
  on public.task_comments (user_task_id, created_at) where user_task_id is not null;
create index if not exists task_comments_assigned_task
  on public.task_comments (assigned_task_id, created_at) where assigned_task_id is not null;

-- 4. Party check (admin OR creator/assignee of the referenced task).
create or replace function public.is_task_party(p_user_task uuid, p_assigned_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_admin()
    or (p_user_task is not null and exists (
          select 1 from public.user_tasks ut
          where ut.id = p_user_task
            and (ut.user_id = auth.uid() or ut.created_by = auth.uid())))
    or (p_assigned_task is not null and exists (
          select 1 from public.assigned_tasks at2
          where at2.id = p_assigned_task
            and (at2.assignee_user_id = auth.uid() or at2.created_by_user_id = auth.uid())));
$$;

alter table public.task_comments enable row level security;

create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.is_task_party(user_task_id, assigned_task_id));

create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_task_party(user_task_id, assigned_task_id)
  );
-- No UPDATE/DELETE in v1 (append-only).

-- 5. Notify the OTHER party/parties on a new comment.
create or replace function public.task_comments_notify_other_party()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_creator uuid; v_assignee uuid; v_title text;
  v_parent_type text; v_parent_id uuid; v_source_code text; v_task_kind text;
begin
  if new.user_task_id is not null then
    v_task_kind := 'user_task'; v_parent_type := 'user_task'; v_parent_id := new.user_task_id;
    select created_by, user_id, title into v_creator, v_assignee, v_title
      from public.user_tasks where id = new.user_task_id;
  else
    v_task_kind := 'assigned_task';
    select created_by_user_id, assignee_user_id, title,
           case when deal_id is not null then 'deal' else 'job' end,
           coalesce(deal_id, job_id), source_code
      into v_creator, v_assignee, v_title, v_parent_type, v_parent_id, v_source_code
      from public.assigned_tasks where id = new.assigned_task_id;
  end if;

  -- notify the assignee unless they authored it
  if v_assignee is not null and v_assignee <> new.author_user_id then
    insert into public.notifications (user_id, type, payload)
    values (v_assignee, 'task_comment', jsonb_build_object(
      'task_kind', v_task_kind, 'task_id', coalesce(new.user_task_id, new.assigned_task_id),
      'parent_type', v_parent_type, 'parent_id', v_parent_id,
      'author_id', new.author_user_id, 'title', v_title,
      'snippet', left(new.body, 200), 'source_code', v_source_code));
  end if;
  -- notify the creator unless they authored it or are the same person as the assignee
  if v_creator is not null and v_creator <> new.author_user_id and v_creator is distinct from v_assignee then
    insert into public.notifications (user_id, type, payload)
    values (v_creator, 'task_comment', jsonb_build_object(
      'task_kind', v_task_kind, 'task_id', coalesce(new.user_task_id, new.assigned_task_id),
      'parent_type', v_parent_type, 'parent_id', v_parent_id,
      'author_id', new.author_user_id, 'title', v_title,
      'snippet', left(new.body, 200), 'source_code', v_source_code));
  end if;
  return new;
end $$;

drop trigger if exists task_comments_notify_other_party on public.task_comments;
create trigger task_comments_notify_other_party
  after insert on public.task_comments
  for each row execute function public.task_comments_notify_other_party();

-- 6. Realtime for live threads.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.task_comments';
  end if;
end $$;

-- ROLLBACK:
--   drop trigger if exists task_comments_notify_other_party on public.task_comments;
--   drop function if exists public.task_comments_notify_other_party();
--   alter publication supabase_realtime drop table if exists public.task_comments;
--   drop table if exists public.task_comments cascade;
--   drop function if exists public.is_task_party(uuid, uuid);
--   drop trigger if exists assigned_tasks_notify_started on public.assigned_tasks;
--   drop function if exists public.assigned_tasks_notify_started();
--   drop trigger if exists user_tasks_notify_started on public.user_tasks;
--   drop function if exists public.user_tasks_notify_started();
--   alter table public.assigned_tasks drop column if exists started_at;
--   alter table public.user_tasks drop column if exists started_at;
```

- [ ] **Step 2: Apply to prod via Supabase MCP**

Use the `apply_migration` tool: `project_id="xujlrclyzxrvxszepquy"`, `name="task_collaboration"`, `query=`<the SQL above>. Expected: `{"success":true}`.

- [ ] **Step 3: Verify schema with execute_sql**

```sql
select
  (select count(*) from information_schema.columns where table_name='user_tasks' and column_name='started_at') as ut_col,
  (select count(*) from information_schema.columns where table_name='assigned_tasks' and column_name='started_at') as at_col,
  (select count(*) from information_schema.tables where table_name='task_comments') as tc_table,
  (select count(*) from pg_policies where tablename='task_comments') as tc_policies,
  (select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='task_comments') as tc_realtime;
```
Expected: `ut_col=1, at_col=1, tc_table=1, tc_policies=2, tc_realtime=1`.

- [ ] **Step 4: RLS role-switch check** (a non-party is blocked, a party allowed)

```sql
-- Pick a real assigned task + its assignee + a stranger.
-- Replace :task, :assignee, :stranger from a quick lookup first.
-- As the assignee: insert should succeed.
begin;
  select set_config('role','authenticated', true);
  select set_config('request.jwt.claims', json_build_object('sub', ':assignee')::text, true);
  insert into public.task_comments (assigned_task_id, author_user_id, body)
    values (':task', ':assignee', 'rls smoke party');  -- expect OK
rollback;
-- As a stranger: insert must raise RLS violation.
begin;
  select set_config('role','authenticated', true);
  select set_config('request.jwt.claims', json_build_object('sub', ':stranger')::text, true);
  insert into public.task_comments (assigned_task_id, author_user_id, body)
    values (':task', ':stranger', 'rls smoke stranger');  -- expect: new row violates RLS
rollback;
```
Expected: first commits clean inside the txn, second errors `new row violates row-level security policy`. (Use a lookup query first to fill the ids; both are rolled back.)

- [ ] **Step 5: Commit** (migration file only; code lands in later tasks)

```bash
git add supabase/migrations/20260625160000_task_collaboration.sql
git commit -m "feat(tasks): migration — started_at + task_comments (parties-only RLS) + notify triggers"
```

---

## Task 2: Types + query key

**Files:**
- Modify: `src/types/supabase.ts`
- Modify: `src/lib/queryKeys.ts`

- [ ] **Step 1: Add `started_at` to both task tables in `src/types/supabase.ts`**

In the `user_tasks` table block, add `started_at: string | null` to `Row`, and `started_at?: string | null` to both `Insert` and `Update`. Do the identical edit in the `assigned_tasks` block. (Find each block by searching `user_tasks: {` and `assigned_tasks: {`.)

- [ ] **Step 2: Add the `task_comments` table block to `src/types/supabase.ts`**

Insert this inside `Database.public.Tables`, alphabetically near other `task*`/`t*` tables:

```ts
      task_comments: {
        Row: {
          id: string
          user_task_id: string | null
          assigned_task_id: string | null
          author_user_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          user_task_id?: string | null
          assigned_task_id?: string | null
          author_user_id: string
          body: string
          created_at?: string
        }
        Update: {
          id?: string
          user_task_id?: string | null
          assigned_task_id?: string | null
          author_user_id?: string
          body?: string
          created_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 3: Add the query key in `src/lib/queryKeys.ts`**

Add to the `queryKeys` object (next to `comments`):

```ts
  taskComments: (kind: 'user' | 'assigned', taskId: string) =>
    ['task-comments', kind, taskId] as const,
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no references to the new types yet, but the file must still compile).

- [ ] **Step 5: Commit**

```bash
git add src/types/supabase.ts src/lib/queryKeys.ts
git commit -m "chore(tasks): types for started_at + task_comments + query key"
```

> NOTE: `npm run types:gen` requires Supabase CLI auth; the hand-edits above keep the build green. Run `types:gen` later to regenerate fully.

---

## Task 3: Pure model — `startedAtIso` + visibility rules

**Files:**
- Modify: `src/features/tasks/taskCard.ts`
- Modify: `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`
- Create: `src/features/tasks/taskStarted.ts`
- Test: `src/features/tasks/taskStarted.test.ts`

- [ ] **Step 1: Write the failing test** `src/features/tasks/taskStarted.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { canStartTask, startedBadgeVisible } from './taskStarted';

describe('canStartTask', () => {
  it('true only for the assignee on an open, not-started task', () => {
    expect(canStartTask({ isAssignee: true, resolved: false, startedAt: null })).toBe(true);
  });
  it('false when not the assignee', () => {
    expect(canStartTask({ isAssignee: false, resolved: false, startedAt: null })).toBe(false);
  });
  it('false when already started', () => {
    expect(canStartTask({ isAssignee: true, resolved: false, startedAt: '2026-06-25T00:00:00Z' })).toBe(false);
  });
  it('false when resolved', () => {
    expect(canStartTask({ isAssignee: true, resolved: true, startedAt: null })).toBe(false);
  });
});

describe('startedBadgeVisible', () => {
  it('true when started and not resolved', () => {
    expect(startedBadgeVisible({ resolved: false, startedAt: '2026-06-25T00:00:00Z' })).toBe(true);
  });
  it('false when not started', () => {
    expect(startedBadgeVisible({ resolved: false, startedAt: null })).toBe(false);
  });
  it('false when resolved (resolved state takes precedence)', () => {
    expect(startedBadgeVisible({ resolved: true, startedAt: '2026-06-25T00:00:00Z' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './taskStarted'`)

Run: `npx vitest run src/features/tasks/taskStarted.test.ts`

- [ ] **Step 3: Implement** `src/features/tasks/taskStarted.ts`

```ts
/** Pure visibility rules for the "Started working" affordance. */
export function canStartTask(p: { isAssignee: boolean; resolved: boolean; startedAt: string | null }): boolean {
  return p.isAssignee && !p.resolved && p.startedAt == null;
}

export function startedBadgeVisible(p: { resolved: boolean; startedAt: string | null }): boolean {
  return !p.resolved && p.startedAt != null;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/features/tasks/taskStarted.test.ts`

- [ ] **Step 5: Add `startedAtIso` to the card model** in `src/features/tasks/taskCard.ts`

In the `TaskCard` type add: `startedAtIso: string | null;` (place after `resolvedAt`). In `userTaskToCard`, add `startedAtIso: row.started_at ?? null,`. In `assignedTaskToCard`, add `startedAtIso: row.started_at ?? null,`.

- [ ] **Step 6: Expose `started_at` on the assigned board row** in `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`

Add `started_at` to `ASSIGNED_TASK_SELECT` (append `, started_at` after `resolved_at, resolved_by_user_id, created_at, importance,`) and add `started_at: string | null;` to the `AssignedTaskRow` type. (`user_tasks` board uses `select('*')`, so `started_at` is automatic once Task 2 typed it.)

- [ ] **Step 7: Typecheck + run the new test**

Run: `npm run typecheck && npx vitest run src/features/tasks/taskStarted.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/taskStarted.ts src/features/tasks/taskStarted.test.ts src/features/tasks/taskCard.ts src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts
git commit -m "feat(tasks): startedAtIso on card model + started-visibility rules"
```

---

## Task 4: `useStartTask` hook

**Files:**
- Create: `src/features/tasks/hooks/useStartTask.ts`

- [ ] **Step 1: Implement** (branch per table to keep each table's Update type under `exactOptionalPropertyTypes`; guard `.is('started_at', null)` prevents re-start races)

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = { kind: 'user' | 'assigned'; id: string };

export function useStartTask() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: captureMutation<Vars, void>('task', 'start', async ({ kind, id }) => {
      const startedAt = new Date().toISOString();
      if (kind === 'user') {
        const { error } = await supabase
          .from('user_tasks').update({ started_at: startedAt }).eq('id', id).is('started_at', null);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('assigned_tasks').update({ started_at: startedAt }).eq('id', id).is('started_at', null);
        if (error) throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/hooks/useStartTask.ts
git commit -m "feat(tasks): useStartTask sets started_at (race-guarded)"
```

---

## Task 5: `StartTaskButton` component + i18n

**Files:**
- Create: `src/features/tasks/StartTaskButton.tsx`
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json`

- [ ] **Step 1: Add i18n keys** — inside the existing `tasks_page` object in **both** files.

`en/common.json` add:
```json
      "started_button": "Started working",
      "started_badge": "Started {{date}}",
      "started_short": "Started",
      "status_open": "Open",
      "status_started": "Started",
      "status_resolved": "Resolved",
      "assignee_label": "Assignee",
      "comments_title": "Comments",
      "comment_placeholder": "Write a comment…",
      "comment_post": "Post",
      "comments_empty": "No comments yet."
```
`el/common.json` add:
```json
      "started_button": "Ξεκίνησα την εργασία",
      "started_badge": "Ξεκίνησε {{date}}",
      "started_short": "Σε εξέλιξη",
      "status_open": "Ανοιχτή",
      "status_started": "Σε εξέλιξη",
      "status_resolved": "Επιλύθηκε",
      "assignee_label": "Ανατέθηκε σε",
      "comments_title": "Σχόλια",
      "comment_placeholder": "Γράψτε ένα σχόλιο…",
      "comment_post": "Αποστολή",
      "comments_empty": "Δεν υπάρχουν σχόλια ακόμη."
```

- [ ] **Step 2: Implement** `src/features/tasks/StartTaskButton.tsx`

```tsx
import { useTranslation } from 'react-i18next';
import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStartTask } from './hooks/useStartTask';
import { canStartTask, startedBadgeVisible } from './taskStarted';

export function StartTaskButton({
  kind, id, isAssignee, resolved, startedAt, locale,
}: {
  kind: 'user' | 'assigned';
  id: string;
  isAssignee: boolean;
  resolved: boolean;
  startedAt: string | null;
  locale: string;
}) {
  const { t } = useTranslation('common');
  const start = useStartTask();

  if (canStartTask({ isAssignee, resolved, startedAt })) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7"
        disabled={start.isPending} onClick={() => start.mutate({ kind, id })}>
        <PlayCircle className="size-3.5" />
        {t('tasks_page.started_button')}
      </Button>
    );
  }
  if (startedBadgeVisible({ resolved, startedAt }) && startedAt) {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(startedAt));
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200">
        <PlayCircle className="size-3" />
        {t('tasks_page.started_badge', { date })}
      </span>
    );
  }
  return null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/StartTaskButton.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(tasks): StartTaskButton (button/badge) + i18n strings"
```

---

## Task 6: comment hooks (`useTaskComments` + `usePostTaskComment`)

**Files:**
- Create: `src/features/tasks/hooks/useTaskComments.ts`
- Create: `src/features/tasks/hooks/usePostTaskComment.ts`

- [ ] **Step 1: Implement** `src/features/tasks/hooks/useTaskComments.ts` (query + realtime; author name via joined profile, the same pattern as `useAssignedTaskDetail`'s creator join)

```ts
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type TaskCommentRow = {
  id: string;
  body: string;
  created_at: string;
  author_user_id: string;
  author: { user_id: string; full_name: string | null; email: string } | null;
};

const SELECT = 'id, body, created_at, author_user_id, author:author_user_id ( user_id, full_name, email )';

export function useTaskComments(kind: 'user' | 'assigned', taskId: string | null) {
  const qc = useQueryClient();
  const col = kind === 'user' ? 'user_task_id' : 'assigned_task_id';

  const query = useQuery<TaskCommentRow[]>({
    enabled: !!taskId,
    queryKey: queryKeys.taskComments(kind, taskId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments').select(SELECT).eq(col, taskId!).order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as TaskCommentRow[];
    },
  });

  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`task-comments-${kind}-${taskId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `${col}=eq.${taskId}` },
        () => { void qc.invalidateQueries({ queryKey: queryKeys.taskComments(kind, taskId) }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc, kind, taskId, col]);

  return query;
}
```

- [ ] **Step 2: Implement** `src/features/tasks/hooks/usePostTaskComment.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = { kind: 'user' | 'assigned'; taskId: string; body: string };

export function usePostTaskComment() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: async ({ kind, taskId, body }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const row =
        kind === 'user'
          ? { user_task_id: taskId, assigned_task_id: null, author_user_id: user.id, body }
          : { user_task_id: null, assigned_task_id: taskId, author_user_id: user.id, body };
      const { error } = await supabase.from('task_comments').insert(row as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_v, { kind, taskId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.taskComments(kind, taskId) });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/hooks/useTaskComments.ts src/features/tasks/hooks/usePostTaskComment.ts
git commit -m "feat(tasks): task comment hooks (query+realtime, insert)"
```

---

## Task 7: `TaskComments` component

**Files:**
- Create: `src/features/tasks/TaskComments.tsx`

- [ ] **Step 1: Implement** `src/features/tasks/TaskComments.tsx`

```tsx
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useTaskComments } from './hooks/useTaskComments';
import { usePostTaskComment } from './hooks/usePostTaskComment';

export function TaskComments({ kind, taskId, locale }: {
  kind: 'user' | 'assigned';
  taskId: string;
  locale: string;
}) {
  const { t } = useTranslation('common');
  const { data: comments = [] } = useTaskComments(kind, taskId);
  const post = usePostTaskComment();
  const [body, setBody] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    post.mutate({ kind, taskId, body: text }, { onSuccess: () => setBody('') });
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('tasks_page.comments_title')}
      </h4>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('tasks_page.comments_empty')}</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.author?.full_name || c.author?.email || '—'}
                </span>{' '}
                · {fmt(c.created_at)}
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={t('tasks_page.comment_placeholder')}
          className="min-h-9 flex-1 resize-y rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <Button type="submit" size="sm" disabled={post.isPending || body.trim().length === 0}>
          {t('tasks_page.comment_post')}
        </Button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/TaskComments.tsx
git commit -m "feat(tasks): TaskComments thread + composer"
```

---

## Task 8: Wire `UserTaskDetailDialog`

**Files:**
- Modify: `src/features/tasks/UserTaskDetailDialog.tsx`

- [ ] **Step 1: Add status line, StartTaskButton, and TaskComments**

Add imports at top:
```tsx
import { StartTaskButton } from './StartTaskButton';
import { TaskComments } from './TaskComments';
```
Replace the closing of the `space-y-3` content block so it includes, after the creator/created `<p>`:
```tsx
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {card.resolved
                ? t('tasks_page.status_resolved', { ns: 'common' })
                : card.startedAtIso
                  ? t('tasks_page.status_started', { ns: 'common' })
                  : t('tasks_page.status_open', { ns: 'common' })}
            </span>
            <StartTaskButton
              kind="user"
              id={card.id}
              isAssignee={card.relation === 'mine'}
              resolved={card.resolved}
              startedAt={card.startedAtIso}
              locale={locale}
            />
          </div>
          <TaskComments kind="user" taskId={card.id} locale={locale} />
```
(The dialog already exposes `card`, `locale`, and `t`. `t` is bound to the `home` namespace here, so pass `{ ns: 'common' }` on the new keys as shown.)

- [ ] **Step 2: Typecheck + run existing dialog/board tests**

Run: `npm run typecheck && npx vitest run src/features/tasks`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/UserTaskDetailDialog.tsx
git commit -m "feat(tasks): personal-task dialog shows status, start button, comments"
```

---

## Task 9: Wire `AssignedTaskDetailDialog`

**Files:**
- Modify: `src/features/assigned_tasks/hooks/useAssignedTaskDetail.ts`
- Modify: `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx`

- [ ] **Step 1: Add `started_at` to the detail query/type** in `useAssignedTaskDetail.ts`

In `AssignedTaskDetail` type add `started_at: string | null;`. In the `SELECT` string append `, started_at` after `status, resolved_at, resolved_by_user_id, created_at,` (i.e. the scalar list). `assignee_user_id` is already selected.

- [ ] **Step 2: Render status/started/assignee + comments** in `AssignedTaskDetailDialog.tsx`

Add imports:
```tsx
import { useAuthStore } from '@/lib/stores/authStore';
import { StartTaskButton } from '@/features/tasks/StartTaskButton';
import { TaskComments } from '@/features/tasks/TaskComments';
import { ImportanceBadge } from '@/features/tasks/ImportanceBadge';
```
Inside the component add: `const meId = useAuthStore((s) => s.user?.id ?? '');`
In the status `<div className="text-xs text-muted-foreground">` block, after the status span, add the StartTaskButton and an importance badge in the title row. Then after the client `<section>` (and before `<DialogFooter>`) insert:
```tsx
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                {t('tasks_page.assignee_label', { ns: 'common' })}:
              </span>
              <ImportanceBadge importance={task.importance as never} />
              <StartTaskButton
                kind="assigned"
                id={task.id}
                isAssignee={task.assignee_user_id === meId}
                resolved={task.status === 'resolved'}
                startedAt={task.started_at}
                locale={locale}
              />
            </div>
            <TaskComments kind="assigned" taskId={task.id} locale={locale} />
```
(`task.importance` exists on the row; `AssignedTaskDetail` types it as part of the select — if missing, add `importance: string;` to the type and `, importance` to SELECT.)

- [ ] **Step 3: Typecheck + run assigned-task tests**

Run: `npm run typecheck && npx vitest run src/features/assigned_tasks`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTaskDetail.ts src/features/assigned_tasks/AssignedTaskDetailDialog.tsx
git commit -m "feat(tasks): delegated-task dialog shows status/assignee, start button, comments"
```

---

## Task 10: "Started" badge on the kanban card

**Files:**
- Modify: `src/features/tasks/TaskKanbanCard.tsx`

- [ ] **Step 1: Add the badge**

Add import: `import { startedBadgeVisible } from './taskStarted';`
In the second metadata `<div>` (the one with source code + delegated badge), append after the delegated badge:
```tsx
        {startedBadgeVisible({ resolved: card.resolved, startedAt: card.startedAtIso }) && (
          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200">
            {t('tasks_page.started_short')}
          </span>
        )}
```
(`t` is bound to `common` in this component already.)

- [ ] **Step 2: Typecheck + run tests**

Run: `npm run typecheck && npx vitest run src/features/tasks`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/TaskKanbanCard.tsx
git commit -m "feat(tasks): Started badge on kanban card"
```

---

## Task 11: Notification presenters — `task_comment` + `task_started`

**Files:**
- Modify: `src/features/notifications/notification-presenters.tsx`

- [ ] **Step 1: Add icons** — update the import and `NotifIcon` switch.

Change the lucide import to include `MessageSquare, PlayCircle`:
```tsx
import { AlertTriangle, AtSign, Bell, CheckCircle2, MessageSquare, PlayCircle } from 'lucide-react';
```
Add cases in `NotifIcon` before `default`:
```tsx
    case 'task_comment':
      return <MessageSquare className={cn(iconClass, 'text-blue-600 dark:text-blue-400')} />;
    case 'task_started':
      return <PlayCircle className={cn(iconClass, 'text-cyan-600 dark:text-cyan-400')} />;
```

- [ ] **Step 2: Add content blocks** in `CompactNotificationContent`, before the final fallback `return`:

```tsx
  if (type === 'task_comment') {
    const author = readString(payload, 'author_id');
    const title = readString(payload, 'title');
    const snippet = readString(payload, 'snippet');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          New comment{title ? <> on <span className="font-semibold">{title}</span></> : null}
        </p>
        {snippet && <p className="mt-0.5 truncate text-muted-foreground italic">&ldquo;{snippet}&rdquo;</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }

  if (type === 'task_started') {
    const title = readString(payload, 'title');
    const code = readString(payload, 'source_code');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          Started working
          {code && <> <span className="rounded bg-muted px-1 py-px font-mono text-[10px]">{code}</span></>}
        </p>
        {title && <p className="mt-0.5 truncate text-muted-foreground">{title}</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }
```
(`readPath` already maps `parent_type` of `user_task` → `/tasks`, `deal` → `/deals/:id`, `job` → `/jobs/:id`, so routing needs no change. The unused `author` var: drop it if eslint flags `no-unused-vars` — keep only `title`/`snippet`.)

- [ ] **Step 3: Build (lint is strict — verify zero warnings)**

Run: `npm run build`
Expected: PASS. If eslint flags an unused `author`, remove that line.

- [ ] **Step 4: Commit**

```bash
git add src/features/notifications/notification-presenters.tsx
git commit -m "feat(notifications): render task_comment + task_started"
```

---

## Task 12: Full verification + live smoke + push

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm run build && npm run test:run`
Expected: typecheck PASS, eslint 0 warnings, vite build OK, all vitest green.

- [ ] **Step 2: Live lifecycle smoke** (Playwright on `www.itdevcrm.com` OR local `npm run dev`)

Sign in as an admin test account. Create a delegated task assigned to a different user; as that user open it → click **Started working** → assert badge shows and the creator received a `task_started` notification (bell). Post a comment as each party → assert the other party gets a `task_comment` notification and the thread updates live. Resolve. Then **delete the smoke rows** (`task_comments`, the task, and the generated `notifications`) via execute_sql, and confirm a non-party cannot read the comments (role-switch SELECT returns 0 rows).

- [ ] **Step 3: Push to main**

```bash
git push origin main
```
Expected: push succeeds (no PR, per project convention).

---

## Self-Review (run before execution)

- **Spec coverage:** comments table (Task 1/6/7), parties-only RLS + `is_task_party` (Task 1), `started_at` + notify triggers (Task 1), `task_comment`/`task_started` notifications (Task 1 + 11), StartTaskButton (Task 5), TaskComments (Task 7), fuller dialogs (Task 8/9), kanban Started badge (Task 10), realtime (Task 1/6), i18n for in-dialog strings (Task 5), tests (Task 3 unit + Task 1 RLS + Task 12 Playwright). ✅
- **Deviation noted:** notification *text* is English literal (matches the existing English-only presenter); only in-dialog/button strings are bilingual. This is intentional consistency, recorded in the spec's "matches codebase" note.
- **Out of scope honored:** no comment edit/delete, no `started_by`, no extra kanban column, no email, no opening task visibility. ✅
