# Task collaboration: comments + "Started working" flag

**Date:** 2026-06-25
**Status:** Approved, ready for implementation plan

## Problem

Tasks in ITDevCRM have a creator and an assignee, but there is no way for them
to communicate on a task, and no way for the assignee to signal that they have
begun the work. Task detail views are also incomplete — they don't surface the
full picture (who's assigned, status, started/resolved stamps). Users want:

1. **Communication** between the task creator and the assignee.
2. **A "Started working on this" button** the assignee can press.
3. **Tasks that demonstrably work** and **show all the information** to the
   people involved in each task.

## Scope & decisions (confirmed with product owner)

- **Two task tables, both in scope.** The `/tasks` board merges
  `user_tasks` (personal/calendar) and `assigned_tasks` (deal/job delegated).
  All three features apply to **both**.
- **Visibility stays restricted.** "Show all info to all users" means the
  *involved* parties (creator + assignee + admin) must see every field — **not**
  that all staff can see all tasks. No SELECT-RLS opening on the task tables.
- **"Started" is a lightweight flag** — a button + badge + timestamp. No new
  kanban column.
- **Notifications are in-app only** (no email). Both *comments* and the
  *started* event notify: a comment pings the other party; starting pings the
  creator once (skipped when creator == assignee). This completes the lifecycle
  the creator already gets pinged for (assigned → started → resolved).

### Key architectural decision: dedicated `task_comments` table

There is an existing shared `comments` table, but it is **open to all logged-in
staff** (read + post; migration `20260619000002`, `parent_type ∈
client/deal/job/lead`). Reusing it for tasks would leak task conversations to
every staff member, contradicting the "keep restricted" decision.

**Decision:** create a dedicated `task_comments` table whose RLS is scoped to
the parent task's parties (creator + assignee + admin). This mirrors the task's
own visibility exactly. Rejected alternative: add a `task` parent_type to the
open `comments` table (less code, but breaks visibility restriction).

## Data model

One migration adds the columns and the new table.

### `user_tasks` — add column
- `started_at timestamptz NULL` — when the assignee marked work started.

### `assigned_tasks` — add column
- `started_at timestamptz NULL` — same semantics.

`started_at` **persists** once set: resolving the task keeps it (history), and it
is **not** cleared on reopen. The "Started" badge only renders while the task is
open and not resolved; once resolved the resolved state takes visual precedence.

### Started-notify triggers
`user_tasks_notify_started` and `assigned_tasks_notify_started`
(AFTER UPDATE, when `started_at` transitions NULL → set): insert a
`notifications` row of type **`task_started`** for the task **creator**
(`created_by` / `created_by_user_id`). Skipped when creator == assignee or the
creator is `auth.uid()` (the actor). Payload mirrors the other task
notifications: `{ task_kind, task_id, parent_type, parent_id, author_id, title,
source_code? }`.

(`started_by` is intentionally omitted — only the assignee can start a task, so
it is always the assignee; storing it would be redundant. The assignee is
already `user_tasks.user_id` / `assigned_tasks.assignee_user_id`.)

### New table: `task_comments`
| column             | type        | notes                                            |
|--------------------|-------------|--------------------------------------------------|
| `id`               | uuid PK     | `gen_random_uuid()`                              |
| `user_task_id`     | uuid NULL   | FK → `user_tasks(id)` ON DELETE CASCADE          |
| `assigned_task_id` | uuid NULL   | FK → `assigned_tasks(id)` ON DELETE CASCADE      |
| `author_user_id`   | uuid NOT NULL | FK → `profiles(user_id)`                        |
| `body`             | text NOT NULL | must be non-empty (CHECK `length(btrim(body)) > 0`) |
| `created_at`       | timestamptz NOT NULL DEFAULT now() |                            |

- **CHECK constraint:** exactly one of `user_task_id` / `assigned_task_id` is set
  (same pattern as `assigned_tasks` deal_id/job_id).
- **Indexes:** `(user_task_id, created_at)` where not null;
  `(assigned_task_id, created_at)` where not null.
- **Realtime:** added to the `supabase_realtime` publication so open threads
  update live (consistent with the existing task tables).

### `task_comments` RLS

A SQL helper `public.is_task_party(p_user_task uuid, p_assigned_task uuid)`
returns true when `auth.uid()` is a party to the referenced task:
- For a `user_task`: `user_id = auth.uid() OR created_by = auth.uid()`.
- For an `assigned_task`: `assignee_user_id = auth.uid() OR created_by_user_id = auth.uid()`.
- Plus the existing admin check (`is_admin()` helper used elsewhere).

Policies:
- **SELECT:** `is_task_party(user_task_id, assigned_task_id)`.
- **INSERT:** `author_user_id = auth.uid() AND is_task_party(user_task_id, assigned_task_id)`.
- **UPDATE / DELETE:** none in v1 (comments are append-only; editing/deleting is
  YAGNI). Admins retain access via the SELECT/INSERT party check + admin branch.

### `task_comments` notify trigger

`task_comments_notify_other_party` (AFTER INSERT): inserts a `notifications`
row of type **`task_comment`** for the *other* party — i.e. whichever of
{creator, assignee} is **not** the author. Skipped when creator == assignee
(self-only task) or when there is no distinct other party. Payload:
`{ task_kind: 'user_task'|'assigned_task', task_id, parent_type, parent_id,
author_id, title, snippet, source_code? }` so the bell can render and route it.

## Behaviour / data flow

1. **Create task** (existing flows) → assignee notified (`task_assigned`, existing).
2. **Assignee opens task detail → "Started working"** (button shown only to the
   assignee while task is open and `started_at IS NULL`) → sets `started_at`.
   Button is replaced by a **"Started · <date>"** badge, and the **creator** is
   notified in-app (`task_started`; skipped when creator == assignee).
3. **Either party posts a comment** in the embedded thread → `task_comments`
   insert → trigger notifies the **other** party in-app → realtime updates the
   open thread for both.
4. **Resolve** (existing flows) → creator notified (`task_resolved`, existing).
5. **Visibility unchanged** — only creator + assignee + admin can read the task
   and its comments.

The existing UPDATE RLS on both task tables already permits the assignee to set
`started_at` (`user_tasks`: user_id/created_by/admin; `assigned_tasks`:
assignee/creator/admin). The "assignee only" rule for *starting* is enforced in
the UI (button visibility); no extra DB policy needed.

## Frontend

### New components
- **`TaskComments`** — message list + composer, parameterised by
  `{ kind: 'user_task'|'assigned_task', taskId }`. Embedded in both detail
  dialogs. Live via realtime.
- **`StartTaskButton`** — renders the "Started working" button or the
  "Started · <date>" badge based on `started_at` + whether the viewer is the
  assignee.

### New hooks
- **`useTaskComments(kind, taskId)`** — query + realtime subscription to
  `task_comments` for one task.
- **`usePostTaskComment()`** — insert a comment (`author_user_id = auth.uid()`).
- **`useStartTask()`** — set `started_at = now()` on the right table by kind.

### Changed components
- **`UserTaskDetailDialog.tsx`** — add a status line (Open / Started / Resolved),
  assignee, started button/badge, started/resolved stamps, and embed
  `TaskComments`.
- **`AssignedTaskDetailDialog.tsx`** — add importance, assignee, started
  button/badge, started/resolved stamps, and embed `TaskComments`.
- **`TaskKanbanCard.tsx`** — small **"Started"** badge when `started_at` is set
  and the task is not resolved.
- **Notification presenters** (`notification-presenters.tsx`) — render the
  `task_comment` and `task_started` types; `readPath()` routes `user_task` →
  `/tasks`, `assigned_task` → the linked deal/job page.
- **Greek i18n strings** for: "Started working", "Started", "Comments",
  "Write a comment…", and the `task_comment` + `task_started` notification text.

## "Show all info" + correctness pass

- Both detail dialogs must display the **full** picture: title, status
  (Open / Started / Resolved), importance, creator, assignee, due date, client,
  linked deal/job, notes/description, started stamp, resolved stamp, comments.
- Verify the whole lifecycle in the real app: create → assign (notify) → start →
  comment (notify) → resolve (notify).

## Testing

- **Unit tests** on pure logic: the "other party" resolver used by the notify
  trigger's intent (mirrored in a small TS helper if used client-side), and the
  `StartTaskButton` visibility rule (assignee + open + not-started).
- **RLS test:** a non-party cannot SELECT or INSERT a `task_comments` row for a
  task they're not on; a party can. (Role-switch technique from the attachments
  RLS work.)
- **Playwright smoke test** on `www.itdevcrm.com` (or local) covering the full
  lifecycle above, asserting the creator receives a `task_started` notification
  and the other party receives a `task_comment` notification, then clean up the
  smoke rows.
- `npm run build` must pass (stricter than `tsc --noEmit`: assert array indices,
  zero eslint warnings).

## Out of scope (YAGNI)

- Editing or deleting comments.
- Opening task visibility to all staff.
- Email on comment/start.
- A separate "In Progress" kanban column or board re-layout.
- `started_by` column.

## Changes / Revert

**Changes**
- New migration: `started_at` on `user_tasks` + `assigned_tasks` + their
  `*_notify_started` triggers; `task_comments` table + indexes + RLS +
  `is_task_party` helper + comment-notify trigger + realtime.
- New frontend: `TaskComments`, `StartTaskButton`, `useTaskComments`,
  `usePostTaskComment`, `useStartTask`.
- Edits: `UserTaskDetailDialog`, `AssignedTaskDetailDialog`, `TaskKanbanCard`,
  `notification-presenters`, i18n.

**Revert**
- The migration includes rollback SQL: `DROP TABLE task_comments CASCADE;`
  `DROP FUNCTION is_task_party(...);` drop the `*_notify_started` triggers and
  their functions; `ALTER TABLE user_tasks DROP COLUMN started_at;`
  `ALTER TABLE assigned_tasks DROP COLUMN started_at;`
  and removal of `task_comments` from the realtime publication.
- Frontend revert: git revert the feature commits (atomic, one concern each).
- No data is destroyed by reverting (comments table is additive; `started_at` is
  additive).

## Notes / gotchas to respect during implementation
- Regenerate Supabase types after the migration (or temp stub, per project habit).
- `phone_normalized`-style generated-column gotchas don't apply here.
- Prod DDL goes through the Supabase MCP (`apply_migration`); Bash/API DDL is
  safety-blocked.
- Push directly to `main` (no PR), atomic commits.
- Rotate any chat-shared `sbp_` token after the session.
