# Task Auto-Comments + Click-to-Open + Resolve Everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linked tasks auto-post 📋 created / ✅ resolved comments into their deal/job/client/lead thread (channel-aware), each comment clickable to open the task dialog in place; `UserTaskDetailDialog` gains the missing participants+admin Resolve button (closing every resolve gap).

**Architecture:** One migration adds `comments.task_key` + four `security definer` triggers that insert real comment rows (thread mapping mirrors `jobCommentThread`). Frontend: `parseTaskKey` + `useUserTask(id)` power a `TaskCommentLink` affordance in `CommentItem`; `UserTaskDetailDialog` gets a footer Resolve via `TaskDetailShell`'s existing `footer` slot; task mutation hooks invalidate `['comments']` for instant same-page freshness.

**Tech Stack:** Postgres/Supabase triggers, React + TS, TanStack Query, Vitest + @testing-library/react.

## Global Constraints

- **Do NOT apply the migration to prod** — commit the file only; the apply runbook (Task 1 Step 3) is main-session-only after user go-ahead.
- Resolve rights stay participants+admin — NO RLS changes.
- `npm run build` must exit 0 (tsc + eslint --max-warnings=0; >500 kB chunk note is advisory). Never run the full vitest suite — only paths named in steps.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Migration — `task_key` column + 4 auto-comment triggers

**Files:**
- Create: `supabase/migrations/20260709170000_task_auto_comments.sql`

**Interfaces:**
- Produces: `comments.task_key text null` (`'assigned:<uuid>'|'user:<uuid>'`); triggers `user_tasks_comment_on_insert/_resolve`, `assigned_tasks_comment_on_insert/_resolve`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Task auto-comments: a linked task posts 📋 on create and ✅ on resolve into
-- its thread (deal General / deal_dev / deal_seo channel, job, client, lead).
-- comments.task_key back-references the task so the UI can open it on click.
-- security definer (comments INSERT RLS requires auth.uid()=author_id; the
-- definer owner bypasses it, same as fanout_mention_notifications).
-- No mention fanout (mentioned_user_ids='{}').
-- ROLLBACK: drop the 4 triggers + functions; optionally
--   alter table public.comments drop column task_key;
-- =============================================================================

alter table public.comments add column if not exists task_key text;

-- ---- user_tasks: create ----
create or replace function public.user_tasks_comment_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_assignee text;
begin
  if new.client_id is not null then v_type := 'client'; v_id := new.client_id;
  elsif new.lead_id is not null then v_type := 'lead'; v_id := new.lead_id;
  else return new; end if;
  select coalesce(nullif(p.full_name,''), p.email) into v_assignee
    from public.profiles p where p.user_id = new.user_id;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.created_by, new.user_id),
    format('📋 New task: "%s" — for %s, due %s · %s',
           new.title, coalesce(v_assignee, '—'),
           coalesce(to_char(new.due_at at time zone 'Europe/Athens', 'DD Mon'), '—'),
           new.importance),
    '{}', 'user:' || new.id);
  return new;
end $$;
create trigger user_tasks_comment_on_insert after insert on public.user_tasks
  for each row execute function public.user_tasks_comment_on_insert();

-- ---- user_tasks: resolve (each open -> completed transition) ----
create or replace function public.user_tasks_comment_on_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid;
begin
  if new.client_id is not null then v_type := 'client'; v_id := new.client_id;
  elsif new.lead_id is not null then v_type := 'lead'; v_id := new.lead_id;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(auth.uid(), new.user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'user:' || new.id);
  return new;
end $$;
create trigger user_tasks_comment_on_resolve after update on public.user_tasks
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function public.user_tasks_comment_on_resolve();

-- ---- assigned_tasks: thread mapping helper logic inline; create ----
create or replace function public.assigned_tasks_comment_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_assignee text; v_st text; v_deal uuid;
begin
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  select coalesce(nullif(p.full_name,''), p.email) into v_assignee
    from public.profiles p where p.user_id = new.assignee_user_id;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, new.created_by_user_id,
    format('📋 New task: "%s" — for %s · %s', new.title, coalesce(v_assignee, '—'), new.importance),
    '{}', 'assigned:' || new.id);
  return new;
end $$;
create trigger assigned_tasks_comment_on_insert after insert on public.assigned_tasks
  for each row execute function public.assigned_tasks_comment_on_insert();

-- ---- assigned_tasks: resolve ----
create or replace function public.assigned_tasks_comment_on_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_st text; v_deal uuid;
begin
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.resolved_by_user_id, auth.uid(), new.assignee_user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'assigned:' || new.id);
  return new;
end $$;
create trigger assigned_tasks_comment_on_resolve after update on public.assigned_tasks
  for each row when (old.status = 'open' and new.status = 'resolved')
  execute function public.assigned_tasks_comment_on_resolve();
```

- [ ] **Step 2: Commit (file only)**

```bash
git add supabase/migrations/20260709170000_task_auto_comments.sql
git commit -m "feat(db): task auto-comment triggers + comments.task_key (file only, NOT applied)"
```

- [ ] **Step 3 (APPLY RUNBOOK — main session, AFTER go-ahead):** apply SQL via Management API, then run this rolled-back DO-block (expect `VERIFY_OK create=client|deal|deal_dev resolve=1`):

```sql
do $v$
declare v_client uuid; v_deal uuid; v_job uuid; v_uid uuid; v_grp uuid; v_sales uuid;
        v_ut uuid; v_at1 uuid; v_at2 uuid; v_create text; v_resolve int;
begin
  select user_id into v_uid from public.profiles limit 1;
  select id into v_grp from public.groups limit 1;
  select stage_id into v_sales from public.deals where stage_id is not null limit 1;
  insert into public.clients (name, status) values ('ZZZ_TASKCMT','active') returning id into v_client;
  insert into public.deals (client_id, title, stage_id, code) values (v_client,'ZZZ T',v_sales,'ZZZT') returning id into v_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, started_at, code)
    values (v_deal, v_client, 'web_dev','one_time','active', now(),'ZZZT') returning id into v_job;
  insert into public.user_tasks (user_id, created_by, title, due_at, importance, client_id)
    values (v_uid, v_uid, 'ZZZ utask', now(), 'high', v_client) returning id into v_ut;
  insert into public.assigned_tasks (title, assignee_user_id, created_by_user_id, department_group_id, deal_id)
    values ('ZZZ dtask', v_uid, v_uid, v_grp, v_deal) returning id into v_at1;
  insert into public.assigned_tasks (title, assignee_user_id, created_by_user_id, department_group_id, job_id)
    values ('ZZZ jtask', v_uid, v_uid, v_grp, v_job) returning id into v_at2;
  select string_agg(parent_type, '|' order by created_at) into v_create
    from public.comments where task_key in ('user:'||v_ut, 'assigned:'||v_at1, 'assigned:'||v_at2)
    and body like '📋%';
  update public.assigned_tasks set status='resolved' where id = v_at1;
  select count(*) into v_resolve from public.comments
    where task_key='assigned:'||v_at1 and body like '✅%' and parent_type='deal';
  raise exception 'VERIFY_OK create=% resolve=%', v_create, v_resolve;
end $v$;
```

Expected: `create=client|deal|deal_dev`, `resolve=1`.

---

### Task 2: `parseTaskKey` + `useUserTask` + tests

**Files:**
- Create: `src/features/tasks/taskCommentRef.ts`
- Create: `src/features/tasks/hooks/useUserTask.ts`
- Test: `src/features/tasks/taskCommentRef.test.ts`

**Interfaces:**
- Produces: `type TaskRef = { kind: 'assigned'|'user'; id: string }`; `parseTaskKey(key: string|null|undefined): TaskRef|null`; `useUserTask(taskId: string)` → TanStack query of `(UserTaskRow & { lead?: TaskLeadJoin|null }) | null`.

- [ ] **Step 1: Failing test** — `src/features/tasks/taskCommentRef.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTaskKey } from './taskCommentRef';

const UUID = '0d3a4f21-9bcd-4bf5-b09b-0ccb7341a7ad';

describe('parseTaskKey', () => {
  it('parses assigned and user keys', () => {
    expect(parseTaskKey(`assigned:${UUID}`)).toEqual({ kind: 'assigned', id: UUID });
    expect(parseTaskKey(`user:${UUID}`)).toEqual({ kind: 'user', id: UUID });
  });
  it('rejects malformed keys', () => {
    expect(parseTaskKey(null)).toBeNull();
    expect(parseTaskKey('')).toBeNull();
    expect(parseTaskKey('task:123')).toBeNull();
    expect(parseTaskKey(`assigned:not-a-uuid`)).toBeNull();
    expect(parseTaskKey(UUID)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/tasks/taskCommentRef.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement** — `src/features/tasks/taskCommentRef.ts`:

```ts
export type TaskRef = { kind: 'assigned' | 'user'; id: string };

const KEY_RE =
  /^(assigned|user):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Parse a comments.task_key back-reference; null for anything malformed. */
export function parseTaskKey(key: string | null | undefined): TaskRef | null {
  if (!key) return null;
  const m = KEY_RE.exec(key);
  return m ? { kind: m[1] as TaskRef['kind'], id: m[2]! } : null;
}
```

`src/features/tasks/hooks/useUserTask.ts` (mirrors `useTaskBoardData`'s select; RLS may return null for non-participants — that's the "no access" signal):

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import type { TaskLeadJoin } from '@/features/tasks/taskCard';

export type UserTaskDetailRow = UserTaskRow & { lead?: TaskLeadJoin | null };

/** Single user_task by id (lead joined). Returns null when the row doesn't
 *  exist OR the viewer lacks RLS access (assignee/creator/admin only). */
export function useUserTask(taskId: string) {
  return useQuery({
    queryKey: ['user-tasks', 'detail', taskId],
    enabled: !!taskId,
    queryFn: async (): Promise<UserTaskDetailRow | null> => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*, lead:leads(id, title, code)')
        .eq('id', taskId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as UserTaskDetailRow | null;
    },
  });
}
```

- [ ] **Step 4: Run** `npx vitest run src/features/tasks/taskCommentRef.test.ts` — PASS (2 tests). Then `npx tsc -b --pretty false 2>&1 | head -5` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/taskCommentRef.ts src/features/tasks/taskCommentRef.test.ts src/features/tasks/hooks/useUserTask.ts
git commit -m "feat(tasks): parseTaskKey + useUserTask(id) for comment back-references"
```

---

### Task 3: `UserTaskDetailDialog` Resolve button + widened invalidations

**Files:**
- Modify: `src/features/home/hooks/useDeleteTask.ts:38` (useToggleTaskComplete onSuccess)
- Modify: `src/features/tasks/UserTaskDetailDialog.tsx`
- Test: `src/features/tasks/UserTaskDetailDialog.resolve.test.tsx`

**Interfaces:**
- Consumes: `useToggleTaskComplete()` → `mutateAsync({ id, completed })`.
- Produces: Resolve button in the dialog footer, gated `!card.resolved && (relation 'mine'|'delegated' || isAdmin)`.

- [ ] **Step 1: Failing test** — `src/features/tasks/UserTaskDetailDialog.resolve.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskCard } from './taskCard';

const auth = { isAdmin: false };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } }) => unknown) =>
    sel({ isAdmin: auth.isAdmin, user: { id: 'me' } }),
}));
const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/home/hooks/useDeleteTask', () => ({
  useToggleTaskComplete: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { resolvedLanguage: 'en' },
  }),
}));
vi.mock('./StartTaskButton', () => ({ StartTaskButton: () => null }));
vi.mock('./TaskDetailShell', () => ({
  TaskDetailShell: ({ title, footer, children }: { title: string; footer?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <span>{title}</span>
      {footer}
      {children}
    </div>
  ),
}));

import { UserTaskDetailDialog } from './UserTaskDetailDialog';

function card(p: Partial<TaskCard>): TaskCard {
  return {
    key: 'user:u1', kind: 'user', id: 'u1', title: 'T', importance: 'low',
    relation: p.relation ?? 'other', resolved: p.resolved ?? false,
    assigneeId: 'a', creatorId: null, createdAtIso: null, dueAt: null,
    resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
    notes: null, clientName: null, leadName: null, ...p,
  };
}

describe('UserTaskDetailDialog resolve button', () => {
  beforeEach(() => { auth.isAdmin = false; mutateAsync.mockClear(); });

  it('assignee sees Resolve and it completes the task', async () => {
    render(<UserTaskDetailDialog card={card({ relation: 'mine' })} onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'tasks_page.resolve' }));
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'u1', completed: true });
  });

  it('creator (delegated) sees Resolve', () => {
    render(<UserTaskDetailDialog card={card({ relation: 'delegated' })} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'tasks_page.resolve' })).toBeInTheDocument();
  });

  it('admin non-party sees Resolve', () => {
    auth.isAdmin = true;
    render(<UserTaskDetailDialog card={card({ relation: 'other' })} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'tasks_page.resolve' })).toBeInTheDocument();
  });

  it('non-participant sees no Resolve; resolved tasks show none either', () => {
    const { rerender } = render(
      <UserTaskDetailDialog card={card({ relation: 'other' })} onOpenChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'tasks_page.resolve' })).not.toBeInTheDocument();
    rerender(<UserTaskDetailDialog card={card({ relation: 'mine', resolved: true })} onOpenChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'tasks_page.resolve' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/tasks/UserTaskDetailDialog.resolve.test.tsx` — FAIL (no Resolve button).

- [ ] **Step 3: Implement.** In `src/features/tasks/UserTaskDetailDialog.tsx`:

Add imports:

```tsx
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { useToggleTaskComplete } from '@/features/home/hooks/useDeleteTask';
```

Add hooks BEFORE the `if (!card) return null;` early return (after the `const locale = …` line):

```tsx
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const toggle = useToggleTaskComplete();
```

Add below the `rows` construction:

```tsx
  const canResolve =
    !card.resolved && (card.relation === 'mine' || card.relation === 'delegated' || isAdmin);
```

Add a `footer` prop to `<TaskDetailShell …>` (next to `action`):

```tsx
          footer={
            canResolve ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={async () => {
                    await toggle.mutateAsync({ id: card.id, completed: true });
                    onOpenChange(false);
                  }}
                >
                  {c('tasks_page.resolve')}
                </Button>
              </div>
            ) : undefined
          }
```

In `src/features/home/hooks/useDeleteTask.ts`, replace `useToggleTaskComplete`'s onSuccess (line 38):

```ts
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['client-tasks'] });
      void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['comments'] });
    },
```

- [ ] **Step 4: Run** `npx vitest run src/features/tasks/UserTaskDetailDialog.resolve.test.tsx src/features/tasks/UserTaskDetailDialog.test.tsx` — PASS (new 4 + existing).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/UserTaskDetailDialog.tsx src/features/tasks/UserTaskDetailDialog.resolve.test.tsx src/features/home/hooks/useDeleteTask.ts
git commit -m "feat(tasks): Resolve button on UserTaskDetailDialog (participants+admin) — closes resolve gap everywhere"
```

---

### Task 4: Clickable task comments (`TaskCommentLink` in `CommentItem`)

**Files:**
- Create: `src/features/comments/TaskCommentLink.tsx`
- Test: `src/features/comments/TaskCommentLink.test.tsx`
- Modify: `src/features/comments/hooks/useComments.ts` (type + select)
- Modify: `src/features/comments/CommentItem.tsx` (render affordance)

**Interfaces:**
- Consumes: `parseTaskKey`, `useUserTask`, `userTaskToCard` (from `@/features/tasks/taskCard`), `AssignedTaskDetailDialog({taskId,onOpenChange})`, `UserTaskDetailDialog({card,onOpenChange})`.
- Produces: `TaskCommentLink({ taskKey: string })`; `CommentRow.task_key: string | null`.

- [ ] **Step 1: Failing test** — `src/features/comments/TaskCommentLink.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const userTask: { row: Record<string, unknown> | null; isLoading: boolean } = { row: null, isLoading: false };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));
vi.mock('@/features/tasks/hooks/useUserTask', () => ({
  useUserTask: () => ({ data: userTask.row, isLoading: userTask.isLoading }),
}));
vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: ({ taskId }: { taskId: string }) => <div>assigned-dialog:{taskId}</div>,
}));
vi.mock('@/features/tasks/UserTaskDetailDialog', () => ({
  UserTaskDetailDialog: ({ card }: { card: { id: string } }) => <div>user-dialog:{card.id}</div>,
}));

import { TaskCommentLink } from './TaskCommentLink';

const UUID = '0d3a4f21-9bcd-4bf5-b09b-0ccb7341a7ad';

describe('TaskCommentLink', () => {
  beforeEach(() => { userTask.row = null; userTask.isLoading = false; });

  it('renders nothing for a malformed key', () => {
    const { container } = render(<TaskCommentLink taskKey="garbage" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the assigned task dialog on click', async () => {
    render(<TaskCommentLink taskKey={`assigned:${UUID}`} />);
    await userEvent.click(screen.getByRole('button', { name: /open task/i }));
    expect(screen.getByText(`assigned-dialog:${UUID}`)).toBeInTheDocument();
  });

  it('opens the user task dialog when the row is accessible', async () => {
    userTask.row = { id: UUID, title: 'T', user_id: 'me', created_by: 'me', due_at: null, completed_at: null, importance: 'low', notes: null, created_at: null, started_at: null, client_id: null, lead_id: null };
    render(<TaskCommentLink taskKey={`user:${UUID}`} />);
    await userEvent.click(screen.getByRole('button', { name: /open task/i }));
    expect(screen.getByText(`user-dialog:${UUID}`)).toBeInTheDocument();
  });

  it('shows the no-access message when the user task row is not readable', async () => {
    userTask.row = null;
    render(<TaskCommentLink taskKey={`user:${UUID}`} />);
    await userEvent.click(screen.getByRole('button', { name: /open task/i }));
    expect(screen.getByText(/not found or you don't have access/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/comments/TaskCommentLink.test.tsx` — FAIL (module not found).

- [ ] **Step 3: Implement** — `src/features/comments/TaskCommentLink.tsx`:

```tsx
import { useState } from 'react';
import { SquareArrowOutUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { parseTaskKey } from '@/features/tasks/taskCommentRef';
import { useUserTask } from '@/features/tasks/hooks/useUserTask';
import { userTaskToCard } from '@/features/tasks/taskCard';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';

/** "Open task" affordance on a task auto-comment; opens the task dialog in
 *  place. RLS decides access: an unreadable user task shows a no-access note. */
export function TaskCommentLink({ taskKey }: { taskKey: string }) {
  const ref = parseTaskKey(taskKey);
  const [open, setOpen] = useState(false);
  if (!ref) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <SquareArrowOutUpRight className="size-3.5" />
        Open task
      </button>
      {open && ref.kind === 'assigned' && (
        <AssignedTaskDetailDialog taskId={ref.id} onOpenChange={(o) => !o && setOpen(false)} />
      )}
      {open && ref.kind === 'user' && (
        <UserTaskById taskId={ref.id} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function UserTaskById({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { data: row, isLoading } = useUserTask(taskId);
  if (isLoading) return null;
  if (!row) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle className="text-sm font-medium">Task</DialogTitle>
          <DialogDescription>Task not found or you don't have access.</DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }
  return <UserTaskDetailDialog card={userTaskToCard(row, meId)} onOpenChange={(o) => !o && onClose()} />;
}
```

- [ ] **Step 4: Wire the data + render.** In `src/features/comments/hooks/useComments.ts`: add `task_key: string | null;` to `CommentRow` (after `reply_to_id`), and add `task_key` to the select string: `'id, parent_type, parent_id, author_id, body, mentioned_user_ids, reply_to_id, task_key, created_at, updated_at, author:profiles!comments_author_id_fkey(user_id, full_name, email)'`.

In `src/features/comments/CommentItem.tsx`: add `import { TaskCommentLink } from './TaskCommentLink';` and directly under `<CommentBody body={comment.body} className="mt-3" />` add:

```tsx
              {comment.task_key && <TaskCommentLink taskKey={comment.task_key} />}
```

- [ ] **Step 5: Run** `npx vitest run src/features/comments/TaskCommentLink.test.tsx src/features/comments` — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/comments/TaskCommentLink.tsx src/features/comments/TaskCommentLink.test.tsx src/features/comments/hooks/useComments.ts src/features/comments/CommentItem.tsx
git commit -m "feat(comments): task auto-comments clickable — open the task dialog in place"
```

---

### Task 5: Instant comment freshness + full verification

**Files:**
- Modify: `src/features/home/hooks/useUpsertTask.ts` (onSuccess)
- Modify: `src/features/assigned_tasks/hooks/useCreateAssignedTask.ts` (onSuccess)
- Modify: `src/features/assigned_tasks/hooks/useResolveAssignedTask.ts` (onSuccess)
- Modify: `src/features/tasks/hooks/useTaskBoardActions.ts` (onSuccess)

**Interfaces:** consumes nothing new; each hook additionally invalidates the `['comments']` prefix (matches `queryKeys.comments(...)` = `['comments', type, id]`).

- [ ] **Step 1: Add `void qc.invalidateQueries({ queryKey: ['comments'] });`** as the last line of each onSuccess:
  - `useUpsertTask.ts` (after the `['lead-tasks']` line)
  - `useCreateAssignedTask.ts` (after the assignedTasksFor* invalidations; note this file uses `qc.invalidateQueries(...)` without `void` — match its local style)
  - `useResolveAssignedTask.ts` (after `['client-tasks']`; same no-`void` style)
  - `useTaskBoardActions.ts` (after the `['tasks']` line)

- [ ] **Step 2: Full build** — `npm run build` — exit 0.

- [ ] **Step 3: Regression sweep** — `npx vitest run src/features/comments src/features/tasks src/features/home src/features/assigned_tasks src/features/deals` — all PASS (flag pre-existing failures only if proven by stash + rerun).

- [ ] **Step 4: Commit**

```bash
git add src/features/home/hooks/useUpsertTask.ts src/features/assigned_tasks/hooks/useCreateAssignedTask.ts src/features/assigned_tasks/hooks/useResolveAssignedTask.ts src/features/tasks/hooks/useTaskBoardActions.ts
git commit -m "feat(tasks): task mutations refresh comment threads (auto-comment freshness)"
```

---

## Changes / Revert

**Changes:** migration `20260709170000_task_auto_comments.sql` (task_key + 4 triggers; apply deferred); new `taskCommentRef.ts`, `useUserTask.ts`, `TaskCommentLink.tsx` (+tests); Resolve button in `UserTaskDetailDialog` + widened `useToggleTaskComplete`; `CommentRow.task_key` + `CommentItem` affordance; `['comments']` invalidations in 4 task hooks.

**Revert:** DB — `drop trigger … on public.user_tasks/assigned_tasks` ×4 + `drop function` ×4 (+ optionally drop `task_key`); auto-comments already posted remain ordinary comments. Code — `git revert` the five commits.

## Self-Review

- **Spec coverage:** auto-comment create+resolve w/ channel mapping ✅ (T1); clickable → in-place dialog incl. no-access fallback ✅ (T2/T4); Resolve everywhere = UserTaskDetailDialog footer gated participants+admin ✅ (T3); instant freshness ✅ (T3/T5); rolled-back prod verification ✅ (T1 runbook).
- **Placeholders:** none.
- **Type consistency:** `TaskRef`/`parseTaskKey` (T2) used in T4; `useUserTask` return feeds `userTaskToCard(row, meId)` (matches `UserTaskRow & {lead}` param shape); `useToggleTaskComplete.mutateAsync({id, completed})` matches existing signature; `CommentRow.task_key` matches the migration column; trigger thread mapping matches `commentChannels.ts` exactly (web_dev→deal_dev; web/local/ai_seo→deal_seo; else job).
