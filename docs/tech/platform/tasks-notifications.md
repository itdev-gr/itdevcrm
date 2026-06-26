# Tasks & Notifications

**Purpose** — Two complementary task models (personal/calendar `user_tasks` and delegated `assigned_tasks`), an append-only `task_comments` collaboration thread, and an in-app `notifications` bell fanned out by `SECURITY DEFINER` triggers.

## Data model

- **`user_tasks`** — personal/calendar tasks. Key cols: `user_id` (the **assignee** — whose calendar it lands on), `created_by` (who made it; lets a creator assign to a colleague), `title`, `notes`, `due_at`, `completed_at` (null = open), `importance` (`low`|`medium`|`high`|`urgent`, NOT NULL default `low`), `started_at`, `client_id` (optional focus). In the realtime publication.
- **`assigned_tasks`** — work-handoff tasks created **from a deal or a job**. Key cols: `deal_id` XOR `job_id` (CHECK `assigned_tasks_one_source`), `client_id` + `source_code` (denormalised from the source by a trigger), `assignee_user_id`, `created_by_user_id`, `status` (`open`|`resolved`), `resolved_at`/`resolved_by_user_id`, `importance`, `started_at`. In the realtime publication.
- **`task_comments`** — parties-only comment thread (NOT the open `public.comments` table). Key cols: `user_task_id` XOR `assigned_task_id` (CHECK `task_comments_one_parent`), `author_user_id`, `body` (non-empty), `created_at`. Append-only (no UPDATE/DELETE policy). In the realtime publication.
- **`notifications`** — the in-app bell. Cols: `user_id`, `type` (free text), `payload` (jsonb), `read_at`. RLS: select/update own only. Indexed on unread + all per user.

Notification **types** seen across triggers: `mention`, `task_assigned`, `task_resolved`, `task_started`, `task_comment`, `lead_noshow`, `constant_na_suggestion`, `overdue`. Payload convention mirrors `mention`: `{ parent_type, parent_id, author_id, title, … }` so the notification column's existing link helpers resolve it (`parent_type` ∈ `deal`/`job`/`user_task`/`lead`/`client`).

## Flow

```mermaid
flowchart TD
  subgraph Personal
    UTC["create personal task"] --> UT[("user_tasks<br/>user_id=assignee,<br/>created_by=maker")]
    UT -->|started_at NULL->set| UNS["user_tasks_notify_started()"]
    UT -->|completed_at set| UNC["user_tasks_notify_creator()"]
    UNS -->|notify creator| N
    UNC -->|notify creator| N
  end
  subgraph Delegated
    ATC["create from deal/job"] -->|BEFORE INSERT| POP["assigned_tasks_populate_source()<br/>fills client_id + source_code"]
    POP --> AT[("assigned_tasks")]
    AT -->|AFTER INSERT| ANA["assigned_tasks_notify_assignee()<br/>type=task_assigned"]
    AT -->|status->resolved| ANC["assigned_tasks_notify_creator()<br/>type=task_resolved"]
    AT -->|started_at set| ANS["assigned_tasks_notify_started()"]
    ANA --> N
    ANC --> N
    ANS --> N
  end
  subgraph Comments
    CC["post comment (party only)"] -->|is_task_party() check| TC[("task_comments")]
    TC -->|AFTER INSERT| TCN["task_comments_notify_other_party()<br/>type=task_comment"]
    TCN -->|notify other party/parties| N
  end
  N[("notifications<br/>(in-app bell, realtime)")]
  N --> BOARD["/tasks kanban by importance<br/>urgent|high|medium|low|resolved"]
```

## Functions / triggers / crons

- **`assigned_tasks_populate_source()`** (BEFORE INSERT) — reads `client_id`/`code` from the source deal or job and overwrites `client_id`/`source_code`, so the row is always consistent with its source; raises if the source is missing.
- **`assigned_tasks_stamp_resolved()`** (BEFORE UPDATE OF status) — stamps/clears `resolved_at`+`resolved_by_user_id` on the `open↔resolved` transition.
- **`assigned_tasks_notify_assignee()`** (AFTER INSERT) — `task_assigned` to the assignee, suppressed on self-assign.
- **`assigned_tasks_notify_creator()`** (AFTER UPDATE OF status) — `task_resolved` to the creator on `open→resolved`, suppressed when creator==resolver.
- **`assigned_tasks_notify_started()`** (AFTER UPDATE OF started_at) — `task_started` to the creator when the assignee marks work started (NULL→set), suppressed if creator is the assignee/actor.
- **`user_tasks_notify_creator()`** (AFTER UPDATE OF completed_at) — `task_resolved` (`parent_type='user_task'`) to `created_by` when a delegated personal task is completed; suppressed when creator==assignee or creator==`auth.uid()` or `created_by` null (legacy).
- **`user_tasks_notify_started()`** (AFTER UPDATE OF started_at) — `task_started` to `created_by` on NULL→set, same suppression rules.
- **`is_task_party(user_task, assigned_task)`** (`SECURITY DEFINER`) — true for admin OR the creator/assignee of the referenced task; the basis of every `task_comments` RLS policy.
- **`task_comments_notify_other_party()`** (AFTER INSERT) — resolves creator+assignee of the parent task and sends `task_comment` to whichever party didn't author it (deduped so a single-person creator/assignee isn't double-notified).
- **Frontend board logic** (`src/features/tasks/taskCard.ts`): `BOARD_COLUMNS = ['urgent','high','medium','low','resolved']`; `buildBoardCards` unions both task tables into a single `TaskCard[]`; `relationOf` → `mine`/`delegated`/`other`; only `mine` cards are draggable; `resolveDrag` maps a drop to `set-importance`/`resolve`/`reopen`/`noop`. `BoardFilter` = `to_me`/`by_me`/`all`.

## Gotchas

- **`user_tasks.user_id` is the assignee, not the creator** — `created_by` is the maker. RLS lets either see/edit/delete the row (`20260610000001`). Don't assume `user_id` = author.
- **Two tables on purpose.** `user_tasks` = personal/calendar (carries `due_at`, `client_id`, calendar realtime); `assigned_tasks` = deal/job work handoffs (carries `source_code`, `deal_id`/`job_id`). The home "assigned to me" widget and the `/tasks` kanban **union both**, so a self-assigned task must not be double-counted — match on the union, not one table.
- **`assigned_tasks` requires exactly one of `deal_id`/`job_id`** (XOR CHECK); `task_comments` requires exactly one parent. Inserting with neither/both fails the constraint.
- **`assigned_tasks` INSERT is gated by group**: only admins or members of `accounting`/`web_seo`/`local_seo`/`web_dev`/`social_media`/`ai_seo`/`hosting`/`ads` may create one, and `created_by_user_id` must equal `auth.uid()`.
- **`task_comments` is parties-only and append-only** — distinct from the open `public.comments` table (which is readable/postable by all staff). Use `is_task_party` for any new access; there is no edit/delete path in v1.
- **Notification suppression is everywhere** — every notify trigger no-ops when the actor is the would-be recipient (self-assign, self-resolve, self-comment, self-start). Adding a new notify path should follow the same `<> author / <> auth.uid()` guards.
- `notifications.type` is **free text** (no CHECK), so a typo'd type silently won't link in the bell — keep the type/payload shape in sync with the frontend `readPath()`/link helpers.
- `client_id` arrives differently per table: `assigned_tasks` always gets it from the source (trigger), `user_tasks` only if the optional client picker was used (nullable, `on delete set null`).

## File references

- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260511000005_user_tasks.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260512000001_assigned_tasks.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260610000001_user_tasks_assignee.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260622210000_task_importance.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260622280000_user_tasks_notify_creator.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260623100000_user_tasks_client_id.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260625160000_task_collaboration.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260502000009_collaboration.sql`
- `/Users/marios/Desktop/Cursor/itdevcrm/src/features/tasks/taskCard.ts`
- `/Users/marios/Desktop/Cursor/itdevcrm/src/features/tasks/importance.ts`
