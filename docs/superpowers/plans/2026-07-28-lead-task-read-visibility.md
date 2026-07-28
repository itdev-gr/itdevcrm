# Lead Task & Conversation Read Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sales rep who can open a lead sees ALL tasks linked to that lead plus each task's full conversation thread (and in-thread files), read-only; writing/resolving stays parties-only.

**Architecture:** One migration widens three SELECT RLS policies (`user_tasks`, `task_comments`, `comment_attachments`) via a new `can_read_task()` helper; the lead Tasks tab already queries by `lead_id` so cards appear automatically. The only UI change is a `readOnly` mode on the `TaskComments` composer, threaded through `TaskDetailShell` into `UserTaskDetailDialog` for non-party viewers.

**Tech Stack:** Supabase Postgres RLS + pgTAP (`supabase test db`), React + TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-lead-task-read-visibility-design.md`

## Global Constraints

- Commit directly to `main`, one commit per task; NO PRs. Before each push run `git fetch origin main` — the owner commits in parallel; `git pull --ff-only` first.
- `npm run build` (tsc -b + eslint `--max-warnings=0`) must pass — it is stricter than `tsc --noEmit`.
- vitest runs against PROD Supabase — new tests must never mutate data; mock all mutation hooks.
- jest-dom matchers are unreliable in this repo — new assertions use core matchers only (`toBe(null)`, `.not.toBe(null)`), never `toBeInTheDocument()`.
- Never put literal secrets/tokens in committed files — reference env vars (e.g. `$SUPABASE_ACCESS_TOKEN`).
- Prod project ref is `xujlrclyzxrvxszepquy` ("CRM"). DDL/DML on prod goes through the Supabase Management API (Bash + curl; a `User-Agent` header is REQUIRED or the API rejects the call).
- Do NOT modify: `task_comments`/`comment_attachments` INSERT policies, `user_tasks` INSERT/UPDATE/DELETE policies, anything on `assigned_tasks`, notification triggers.

---

### Task 1: RLS migration + pgTAP regression test

**Files:**
- Create: `supabase/tests/lead_task_read_rls.sql`
- Create: `supabase/migrations/20260728120000_lead_task_read_visibility.sql`

**Interfaces:**
- Consumes: existing `public.is_task_party(uuid, uuid)` (secdef; already grants admins), `public.leads.owner_user_id`, `public.user_tasks.lead_id`.
- Produces: `public.can_read_task(p_user_task uuid, p_assigned_task uuid) returns boolean` — read-gate used by the two comment policies. Later tasks rely only on the RLS behavior, not on calling this from the app.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/lead_task_read_rls.sql` (models `supabase/tests/comment_attachments_rls.sql` — same jwt-claims role-switch harness):

```sql
-- supabase/tests/lead_task_read_rls.sql
-- Run with: supabase test db   (transactional; rolls back)
--
-- RLS regression for lead task read visibility (spec 2026-07-28):
--   (a) the lead's OWNER (non-party, non-admin) READS the task, its thread,
--       and in-thread files — but CANNOT post (42501);
--   (b) another rep (not the lead owner) sees ZERO rows for all three;
--   (c) a task party still reads AND posts (unchanged).
begin;
select plan(10);

select has_function('public', 'can_read_task', array['uuid','uuid'], 'helper exists');

-- Fixture as superuser: a lead owned by a NON-admin rep; a task on it whose
-- assignee+creator are BOTH someone else; one thread message with one file.
do $$
declare
  v_lead uuid; v_owner uuid; v_outsider uuid;
  v_parties uuid[]; v_assignee uuid; v_creator uuid;
  v_task uuid; v_comment uuid;
begin
  select l.id, l.owner_user_id into v_lead, v_owner
    from public.leads l
    join public.profiles p on p.user_id = l.owner_user_id
   where coalesce(p.is_admin, false) = false
   limit 1;

  select array_agg(user_id) into v_parties from (
    select user_id from public.profiles where user_id <> v_owner limit 2) s;
  v_assignee := v_parties[1];
  v_creator  := v_parties[2];

  select user_id into v_outsider from public.profiles
   where coalesce(is_admin, false) = false
     and user_id not in (v_owner, v_assignee, v_creator)
   limit 1;

  insert into public.user_tasks (user_id, created_by, title, due_at, lead_id)
    values (v_assignee, v_creator, 'pgTAP lead task', now(), v_lead)
    returning id into v_task;

  insert into public.task_comments (user_task_id, author_user_id, body)
    values (v_task, v_creator, 'pgTAP thread message')
    returning id into v_comment;

  insert into public.comment_attachments (task_comment_id, storage_path, file_name, uploaded_by)
    values (v_comment, 'comment/t/pgtap-lead.png', 'pgtap-lead.png', v_creator);

  perform set_config('t.owner',    v_owner::text,    true);
  perform set_config('t.outsider', v_outsider::text, true);
  perform set_config('t.assignee', v_assignee::text, true);
  perform set_config('t.task',     v_task::text,     true);
  perform set_config('t.comment',  v_comment::text,  true);
end $$;

-- ---- (a) Lead OWNER (non-party): reads everything, writes nothing. ----
set local role authenticated;
set local "request.jwt.claims" to
  (select json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text);

select is((select count(*)::int from public.user_tasks
            where id = current_setting('t.task')::uuid),
  1, 'lead owner SEES the non-party task on their lead');
select is((select count(*)::int from public.task_comments
            where user_task_id = current_setting('t.task')::uuid),
  1, 'lead owner READS the thread');
select is((select count(*)::int from public.comment_attachments
            where task_comment_id = current_setting('t.comment')::uuid),
  1, 'lead owner SEES the in-thread file');
select throws_ok(
  format($f$ insert into public.task_comments (user_task_id, author_user_id, body)
             values (%L, %L, 'should fail') $f$,
         current_setting('t.task'), current_setting('t.owner')),
  '42501', null, 'lead owner CANNOT post into the thread (read-only)');

-- ---- (b) Another rep (NOT the lead owner): zero rows everywhere. ----
reset role;
set local role authenticated;
set local "request.jwt.claims" to
  (select json_build_object('sub', current_setting('t.outsider'), 'role', 'authenticated')::text);

select is((select count(*)::int from public.user_tasks
            where id = current_setting('t.task')::uuid),
  0, 'other rep sees ZERO tasks on someone else''s lead');
select is((select count(*)::int from public.task_comments
            where user_task_id = current_setting('t.task')::uuid),
  0, 'other rep reads ZERO thread messages');
select is((select count(*)::int from public.comment_attachments
            where task_comment_id = current_setting('t.comment')::uuid),
  0, 'other rep sees ZERO in-thread files');

-- ---- (c) A PARTY (assignee): unchanged — reads and posts. ----
reset role;
set local role authenticated;
set local "request.jwt.claims" to
  (select json_build_object('sub', current_setting('t.assignee'), 'role', 'authenticated')::text);

select is((select count(*)::int from public.task_comments
            where user_task_id = current_setting('t.task')::uuid),
  1, 'party still reads the thread');
select lives_ok(
  format($f$ insert into public.task_comments (user_task_id, author_user_id, body)
             values (%L, %L, 'party reply') $f$,
         current_setting('t.task'), current_setting('t.assignee')),
  'party still posts into the thread');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test suite to verify the new file fails**

Run: `supabase test db`
Expected: `lead_task_read_rls.sql` FAILS — `has_function` fails (no `can_read_task`) and the three owner-read checks return 0. Existing test files (incl. `comment_attachments_rls.sql`) still pass.
Fallback if the local stack cannot start (no Docker): skip to Step 3 and prove behavior in Task 5's prod harness — but still commit this test file for CI/local use.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260728120000_lead_task_read_visibility.sql`:

```sql
-- =============================================================================
-- Lead task & conversation READ visibility for lead-visible users.
-- Spec: docs/superpowers/specs/2026-07-28-lead-task-read-visibility-design.md
--
-- Whoever can open a lead (owner rep; admins already pass everywhere) can now
-- READ all user_tasks linked to it, their task_comments threads, and the
-- files inside those threads. Strictly read-only: every INSERT/UPDATE/DELETE
-- policy is untouched, so commenting/resolving/editing stays parties-only.
-- =============================================================================

create or replace function public.can_read_task(p_user_task uuid, p_assigned_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_task_party(p_user_task, p_assigned_task)
    or (p_user_task is not null and exists (
          select 1
            from public.user_tasks ut
            join public.leads l on l.id = ut.lead_id
           where ut.id = p_user_task
             and l.owner_user_id = auth.uid()));
$$;

revoke all on function public.can_read_task(uuid, uuid) from public;
grant execute on function public.can_read_task(uuid, uuid) to authenticated;

drop policy if exists user_tasks_select on public.user_tasks;
create policy user_tasks_select on public.user_tasks
  for select to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = created_by
    or public.current_user_is_admin()
    or (lead_id is not null and exists (
          select 1 from public.leads l
          where l.id = user_tasks.lead_id and l.owner_user_id = auth.uid()))
  );

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.can_read_task(user_task_id, assigned_task_id));

drop policy if exists comment_attachments_select on public.comment_attachments;
create policy comment_attachments_select on public.comment_attachments
  for select to authenticated
  using (
    comment_id is not null  -- general comments stay visible to all staff
    or exists (
      select 1 from public.task_comments tc
       where tc.id = comment_attachments.task_comment_id
         and public.can_read_task(tc.user_task_id, tc.assigned_task_id)));

-- ROLLBACK:
-- drop policy if exists user_tasks_select on public.user_tasks;
-- create policy user_tasks_select on public.user_tasks
--   for select to authenticated
--   using (auth.uid() = user_id or auth.uid() = created_by or public.current_user_is_admin());
-- drop policy if exists task_comments_select on public.task_comments;
-- create policy task_comments_select on public.task_comments
--   for select to authenticated
--   using (public.is_task_party(user_task_id, assigned_task_id));
-- drop policy if exists comment_attachments_select on public.comment_attachments;
-- create policy comment_attachments_select on public.comment_attachments
--   for select to authenticated
--   using (comment_id is not null or exists (
--     select 1 from public.task_comments tc
--      where tc.id = comment_attachments.task_comment_id
--        and public.is_task_party(tc.user_task_id, tc.assigned_task_id)));
-- drop function if exists public.can_read_task(uuid, uuid);
```

- [ ] **Step 4: Run the test suite to verify it passes**

Run: `supabase test db`
Expected: ALL files pass, including the new `lead_task_read_rls.sql` (10/10) and the untouched `comment_attachments_rls.sql` (assigned-task path unchanged — regression guard).

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/lead_task_read_rls.sql supabase/migrations/20260728120000_lead_task_read_visibility.sql
git commit -m "feat(tasks): lead-visible users read all lead tasks + threads (RLS, read-only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `TaskComments` readOnly mode

**Files:**
- Modify: `src/features/tasks/TaskComments.tsx:41-45` (props) and `:138-175` (composer form)
- Modify: `src/features/tasks/TaskDetailShell.tsx:36-52` (prop threading) and `:80`
- Test: `src/features/tasks/TaskComments.readonly.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Task 1 (pure UI).
- Produces: `TaskComments` accepts optional `readOnly?: boolean` (default `false`; `true` hides the composer form entirely). `TaskDetailShell` accepts optional `commentsReadOnly?: boolean` and forwards it as `TaskComments`'s `readOnly`. Task 3 depends on `commentsReadOnly`.

- [ ] **Step 1: Write the failing test**

Create `src/features/tasks/TaskComments.readonly.test.tsx` (mock set copied from `TaskComments.draft.test.tsx`; core matchers only):

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@/lib/i18n';

vi.mock('./hooks/usePostTaskComment', () => ({
  usePostTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/comments/hooks/useUploadCommentAttachment', () => ({
  useUploadCommentAttachment: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./hooks/useTaskComments', () => ({
  useTaskComments: () => ({ data: [] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' }, isAdmin: false }),
}));
vi.mock('@/features/comments/hooks/useProfileDirectory', () => ({
  useProfileDirectory: () => ({ data: [] }),
}));

import { TaskComments } from './TaskComments';

describe('TaskComments readOnly', () => {
  it('hides the composer when readOnly', () => {
    const { container } = render(
      <TaskComments kind="user" taskId="t1" locale="en-GB" readOnly />,
    );
    expect(container.querySelector('form')).toBe(null);
    expect(container.querySelector('textarea')).toBe(null);
  });

  it('shows the composer by default', () => {
    const { container } = render(<TaskComments kind="user" taskId="t1" locale="en-GB" />);
    expect(container.querySelector('form')).not.toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/TaskComments.readonly.test.tsx`
Expected: FAIL — TS error / first assertion fails (`readOnly` prop unknown; form always rendered).

- [ ] **Step 3: Implement**

In `src/features/tasks/TaskComments.tsx`, change the signature (line 41):

```tsx
export function TaskComments({ kind, taskId, locale, readOnly = false }: {
  kind: 'user' | 'assigned';
  taskId: string;
  locale: string;
  readOnly?: boolean;
}) {
```

Wrap the composer `<form …>…</form>` block (currently lines 138–175) in a conditional — the form JSX itself is unchanged:

```tsx
      {!readOnly && (
        <form
          onSubmit={onSubmit}
          {...dnd.dropZoneProps}
          className={cn(
            'relative flex items-end gap-2',
            dnd.isDragging && 'rounded-xl ring-2 ring-primary/50',
          )}
        >
          {/* …existing children exactly as-is… */}
        </form>
      )}
```

In `src/features/tasks/TaskDetailShell.tsx`, add `commentsReadOnly` to the destructured props and type (after `commentsReplacement?: ReactNode;` add `commentsReadOnly?: boolean;`), and change line 80:

```tsx
          {commentsReplacement ?? (
            <TaskComments kind={commentsKind} taskId={commentsTaskId} locale={locale} readOnly={commentsReadOnly} />
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/TaskComments.readonly.test.tsx src/features/tasks/TaskComments.draft.test.tsx`
Expected: PASS both (draft test proves default behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/TaskComments.tsx src/features/tasks/TaskDetailShell.tsx src/features/tasks/TaskComments.readonly.test.tsx
git commit -m "feat(tasks): read-only mode for the task thread composer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Observer (non-party) mode in `UserTaskDetailDialog` + lead tab regression test

**Files:**
- Modify: `src/features/tasks/UserTaskDetailDialog.tsx:114-116`
- Test: `src/features/tasks/UserTaskDetailDialog.test.tsx` (extend)
- Test: `src/features/leads/LeadTasksTab.test.tsx` (extend)

**Interfaces:**
- Consumes: `commentsReadOnly?: boolean` on `TaskDetailShell` (Task 2); `TaskCard.relation: 'mine' | 'delegated' | 'other'` from `src/features/tasks/taskCard.ts` (`'other'` = viewer is neither assignee nor creator).
- Produces: nothing new — behavior only. NOTE for reviewer: resolve footer and Start button already self-hide for non-party non-admin (`resolveAction` returns `null`; `canStartTask` false), so the composer gate is the ONLY needed change.

- [ ] **Step 1: Write the failing dialog test**

Append to `src/features/tasks/UserTaskDetailDialog.test.tsx` (inside the existing `describe`; the dialog renders in a portal, so query `document.body`; core matchers only):

```tsx
  it('hides the thread composer for a non-party observer', () => {
    const observer = { ...card, relation: 'other' as const, assigneeId: 'a1', creatorId: 'c1' };
    render(wrap(<UserTaskDetailDialog card={observer} onOpenChange={() => {}} />));
    expect(document.body.querySelector('textarea')).toBe(null);
  });

  it('keeps the thread composer for a party', () => {
    render(wrap(<UserTaskDetailDialog card={card} onOpenChange={() => {}} />));
    expect(document.body.querySelector('textarea')).not.toBe(null);
  });
```

- [ ] **Step 2: Run test to verify the observer case fails**

Run: `npx vitest run src/features/tasks/UserTaskDetailDialog.test.tsx`
Expected: FAIL — observer case finds a `textarea` (composer always rendered today); party case passes.

- [ ] **Step 3: Implement**

In `src/features/tasks/UserTaskDetailDialog.tsx`, after line 28 (`const unresolve = …`) add:

```tsx
  // Non-party observer (e.g. the lead's owner reading a task between two other
  // people): the thread is visible via RLS but strictly read-only.
  const isObserver = card ? card.relation === 'other' && !isAdmin : false;
```

(Compute after the `if (!card) return null;` guard is fine too — but hooks above must stay unconditional; a plain `const` derived from `card` may live before the guard as shown.)

Then pass it to the shell (line 114 area):

```tsx
          commentsKind="user"
          commentsTaskId={card.id}
          commentsReadOnly={isObserver}
          locale={locale}
```

- [ ] **Step 4: Run dialog tests to verify they pass**

Run: `npx vitest run src/features/tasks/UserTaskDetailDialog.test.tsx`
Expected: PASS (all cases, including the pre-existing three).

- [ ] **Step 5: Write the lead-tab regression test (failing check not expected — this locks in behavior)**

Append to `src/features/leads/LeadTasksTab.test.tsx`. The file mocks `useLeadTasks` returning the module-level `cards` array — push an observer card inside the new test:

```tsx
  it('lists a task the viewer is not party to and opens its detail dialog', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    cards.push({
      key: 'user:u9', kind: 'user', id: 'u9', title: 'Foreign task',
      importance: 'high', relation: 'other', resolved: false,
      assigneeId: 'a1', creatorId: 'c1', createdAtIso: null, dueAt: null,
      resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
      notes: null, clientName: null, clientId: null, leadName: null,
      creatorResolvedAt: null, assigneeResolvedAt: null, summary: null,
    });
    render(wrap(<LeadTasksTab leadId="L1" leadTitle="Bakery" />));
    await user.click(screen.getByText('Foreign task'));
    expect(document.body.textContent).toContain('Foreign task');
    cards.length = 0;
  });
```

NOTE: `UserTaskDetailDialog` is NOT mocked in this file — it renders for real (portal), which also exercises the observer path end-to-end; `cards.length = 0` restores the fixture for other tests.

- [ ] **Step 6: Run the lead tab tests**

Run: `npx vitest run src/features/leads/LeadTasksTab.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/UserTaskDetailDialog.tsx src/features/tasks/UserTaskDetailDialog.test.tsx src/features/leads/LeadTasksTab.test.tsx
git commit -m "feat(tasks): read-only observer mode for non-party viewers of lead tasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Full verification + push

**Files:** none new.

**Interfaces:** n/a — gate task.

- [ ] **Step 1: Strict build**

Run: `npm run build`
Expected: exits 0, zero warnings.

- [ ] **Step 2: Touched-area test sweep**

Run: `npx vitest run src/features/tasks src/features/leads`
Expected: all pass. (Do NOT run the full suite blindly — vitest hits PROD; the tasks/leads scope is the affected area.)

- [ ] **Step 3: Push**

```bash
git fetch origin main && git pull --ff-only origin main && git push origin main
```

Expected: push succeeds (resolve any parallel owner commits via the ff-only pull first). Vercel auto-deploys the UI. NOTE: until Task 5 applies the migration, prod behavior is unchanged — the UI change is inert (non-party viewers can't load the task row at all), so deploying first is safe.

---

### Task 5: Apply migration to prod + harness verification + smoke

**Files:** none — prod operation (STOP: requires the owner's explicit go-ahead in-session before running anything in this task).

**Interfaces:** consumes the migration SQL from Task 1 verbatim.

- [ ] **Step 1: Get owner go-ahead**

Confirm with the owner: "Apply `20260728120000_lead_task_read_visibility.sql` to prod CRM (`xujlrclyzxrvxszepquy`)?" Do not proceed without a yes in this session.

- [ ] **Step 2: Apply the migration via Management API**

Send the ENTIRE migration file body (Task 1 Step 3) as the `query`:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "User-Agent: itdevcrm-cli" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{"query": "<paste the full migration SQL here, JSON-escaped>"}
JSON
```

(Practical route: write the migration SQL to a scratch file and build the JSON with `python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' <file>` piped to curl — avoids escaping mistakes.)
Expected: HTTP 200, empty result array.

- [ ] **Step 3: Prod harness verification (read-only, rolls back)**

First discover a real fixture — a lead-linked task whose lead owner is NOT a party:

```sql
select ut.id as task_id, ut.lead_id, l.owner_user_id as owner
  from user_tasks ut join leads l on l.id = ut.lead_id
 where ut.lead_id is not null
   and l.owner_user_id not in (ut.user_id, coalesce(ut.created_by, ut.user_id))
 limit 1;
```

Then run the jwt-claims harness in ONE Management-API call (single transaction, ends in rollback), substituting `<OWNER>` / `<TASK>` from the discovery row:

```sql
begin;
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         json_build_object('sub', '<OWNER>', 'role', 'authenticated')::text, true);
select (select count(*) from user_tasks where id = '<TASK>') as owner_sees_task,
       (select count(*) from task_comments where user_task_id = '<TASK>') as owner_sees_thread;
rollback;
```

Expected: `owner_sees_task = 1`; `owner_sees_thread` ≥ 0 (equals the thread's message count). Repeat with `sub` set to a different non-admin rep's uuid: both counts must be `0`.

- [ ] **Step 4: Browser smoke on prod**

Log in as a sales test account (credentials in owner memory `project_smoke_test_account` — never write them into docs), open one of that rep's leads → Tasks tab: a task created between other users is listed; opening it shows the thread with NO composer and NO Resolve button. Log in as a second rep: that lead/task is not reachable.

- [ ] **Step 5: Record the apply**

```bash
git commit --allow-empty -m "chore(db): 20260728120000_lead_task_read_visibility APPLIED to prod

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Close the loop — spec status + memory

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-lead-task-read-visibility-design.md:4` (Status line)

**Interfaces:** n/a.

- [ ] **Step 1: Update spec status**

Change the `Status:` line to: `Status: implemented + applied to prod 2026-07-28 (commits <list>; pgTAP 10/10; prod harness verified)` — fill the real commit hashes.

- [ ] **Step 2: Commit + push**

```bash
git add docs/superpowers/specs/2026-07-28-lead-task-read-visibility-design.md
git commit -m "docs(specs): lead task read visibility — implemented + applied

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 3: Memory** (main session, not a subagent): write `project_lead_task_read_visibility.md` memory + MEMORY.md index line noting: lead owner reads all lead tasks/threads read-only via `can_read_task()`; write paths untouched.

---

## Accepted side-effects (documented, no code)

- The home calendar's "All team" window fetch (`useUserTasks` without `ownerUserId`) may now include observer tasks on the rep's own leads if due in-window — acceptable: they concern the rep's leads. The `/tasks` board is NOT affected (its member query filters `user_id.eq.me,created_by.eq.me` explicitly in `useTaskBoardData.ts:45`).
- Admins gain nothing new (already covered by every policy).
- 💬 unread counts stay RLS-driven; observer-readable threads counting is acceptable.
