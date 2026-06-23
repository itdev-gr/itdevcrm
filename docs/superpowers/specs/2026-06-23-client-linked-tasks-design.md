# Client-linked tasks — design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## Goal

Let any task — personal or delegated — optionally be tied to a **client**, via a
searchable client picker available in **every** task-creation flow. When a client
is set, the task appears on that client's new **Tasks** tab (mirroring how the
deal/job "pipeline" pages already list their tasks). Also: a "New task" button and
click-to-open detail on the `/tasks` page.

## Background (current state)

Two task tables:

- **`user_tasks`** — personal to-dos. Columns: `user_id`, `title`, `notes`,
  `due_at`, `importance`, `completed_at`, `created_by`. **No client link today.**
  RLS SELECT: `auth.uid() = user_id OR auth.uid() = created_by OR is_admin`.
- **`assigned_tasks`** — delegated to a teammate. Already has `client_id`
  (auto-filled by the `assigned_tasks_populate_source` BEFORE-INSERT trigger from
  `deal_id`/`job_id`), plus `description`, `department_group_id`, `importance`,
  `status`. Created via `NewAssignedTaskDialog` on deal/job pages.

The `/tasks` page (`MyTasksPage`) unions both into a `TaskCard` model
(`taskCard.ts`) and renders a kanban (`TaskKanbanCard`). Cards currently have **no
click action** and the page has **no create button**.

A rich read-only dialog (`AssignedTaskDetailDialog`) already shows a delegated
task's creator description + client/contact + open-deal/job link; it's used on
deal/job pages but not on `/tasks`.

The client page (`ClientDetailPage`) has tabs overview / jobs / comments /
attachments / contracts / activity — **no Tasks tab**.

No reusable client search/combobox component exists.

## Decisions (confirmed with product owner)

1. The optional client picker applies to **both** personal and delegated tasks.
2. The client's Tasks tab shows **every** task linked to that client — personal +
   delegated, including delegated tasks created on the client's deals/jobs (those
   already carry `client_id`).
3. The `/tasks` "New task" button creates a **personal** task (not a delegation).
   Delegation continues to live on deal/job/client pages.
4. Card-detail on `/tasks` is **view-only** (plus the existing Resolve/Reopen).

## Changes

### A. Data model — `user_tasks.client_id`

- New migration `20260623xxxxxx_user_tasks_client_id.sql`:
  - `alter table public.user_tasks add column client_id uuid references public.clients(id) on delete set null;`
  - `create index user_tasks_client_id on public.user_tasks (client_id) where client_id is not null;`
- Regenerate `src/types/supabase.ts` (or hand-patch the `user_tasks` Row/Insert
  types if `types:gen` is unavailable, matching the project's stub pattern).
- No change to `assigned_tasks` schema (already has `client_id`).

### B. `ClientPicker` component (reusable, searchable)

- New `src/features/clients/ClientPicker.tsx`: a debounced type-to-search input
  that lists matching clients (by `name`/`code`) and lets the user select one or
  clear it. Controlled via `value: { id, name } | null` + `onChange`.
- Backed by a lightweight `useClientSearch(term)` hook querying
  `clients(id, name, code)` with `name ilike`/`code ilike`, `archived = false`,
  capped (e.g. 20 rows), `enabled` when term length ≥ 2. (Avoids loading all
  clients with `select('*')`.)
- Optional/clearable by default; emits `client_id` (or null) to the form.

### C. Client picker in every creation form

- **`TaskDialog`** (personal, `useUpsertTask`): add the `ClientPicker`; persist
  `client_id` (nullable) on insert/update. Pre-fill when the dialog is opened with
  a client context (see E).
- **`NewAssignedTaskDialog`** (delegated): add the `ClientPicker`. When opened from
  a deal/job, pre-select that source's client (shown, editable). Extend
  `useCreateAssignedTask` input to accept an optional `clientId`; when provided,
  pass it through (the trigger still fills it from deal/job when omitted).

### D. Client page — new **Tasks** tab

- New `ClientTasksTab` component (a dedicated component, since it must **union**
  personal + delegated tasks — `AssignedTasksTab` only handles `assigned_tasks`).
  Shows, for `clientId`:
  - delegated tasks: `assigned_tasks` where `client_id = clientId`,
  - personal tasks: `user_tasks` where `client_id = clientId`,
  unified into a simple Open / Resolved list (reuse `TaskCard`/`taskCard.ts`
  mapping where practical). Each row links to its source (deal/job) when present
  and opens the detail popup (see F).
- A "+ New task" button on the tab opens the personal-task `TaskDialog`
  pre-selecting the current client (and is the natural place to also delegate —
  out of scope unless requested).
- Add the tab to `ClientDetailPage` `Tabs`.
- New query hooks + `queryKeys.clientTasks(clientId)`; realtime/invalidation on
  task create/resolve.
- **Visibility:** bounded by existing RLS — a viewer sees delegated tasks per the
  assigned-task rules and personal tasks where they are `user_id`/`created_by`;
  admins see all. Documented, not changed.

### E. `/tasks` "New task" button

- Add a header button on `MyTasksPage` that opens `TaskDialog` in create mode
  (personal task, with the optional `ClientPicker`). Invalidate the board query on
  success.

### F. `/tasks` card click → detail popup

- `TaskKanbanCard`: clicking the card body (not the inner Resolve button / source
  link) opens a detail view based on `card.kind`:
  - `assigned` → existing `AssignedTaskDetailDialog` (taskId).
  - `user` → new small read-only `UserTaskDetailDialog`: title, notes, due date,
    importance, linked client (if any), creator, plus Resolve/Reopen.
- Wire open/close state in `TasksKanbanBoard`.

## Out of scope (YAGNI)

- Delegating a teammate task from the `/tasks` button or client tab (creation there
  is personal-only for now).
- Editing tasks from the detail popup (view-only).
- Changing `assigned_tasks` visibility/RLS or the populate-source trigger.
- A client filter on the `/tasks` kanban itself.

## Testing (TDD, small commits per task)

- `ClientPicker` / `useClientSearch`: renders matches, debounces, selects, clears.
- `user_tasks` client wiring: `useUpsertTask` sends `client_id`; `TaskDialog`
  shows the picker and submits it.
- `useCreateAssignedTask`: passes `clientId` when provided.
- Client Tasks tab query: unions personal + delegated for a client; open/resolved
  split.
- Card click routing: `assigned` → assigned dialog, `user` → user dialog; inner
  buttons/links don't trigger the popup.
- Migration applied to prod via Supabase MCP (DDL); verify column + index + a
  round-trip insert/select.

## Changes / Revert

- **Migration:** `user_tasks.client_id` column + index. Rollback in-file:
  `drop index if exists user_tasks_client_id; alter table public.user_tasks drop column if exists client_id;`
- **Code:** new `ClientPicker`, `useClientSearch`, `UserTaskDetailDialog`,
  `ClientTasksTab` (+ hooks); edits to `TaskDialog`, `useUpsertTask`,
  `NewAssignedTaskDialog`, `useCreateAssignedTask`, `MyTasksPage`,
  `TasksKanbanBoard`, `TaskKanbanCard`, `ClientDetailPage`, `queryKeys`, i18n
  (en + el). Atomic commits per task; revert = git revert of those commits +
  rollback migration.
