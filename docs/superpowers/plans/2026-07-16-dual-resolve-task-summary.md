# Dual-Sided Task Resolve + AI Resolve-Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks with two parties close only when BOTH creator and assignee resolve; on full close an edge function posts a short Greek AI summary of the task's comment thread into the linked entity's comments and stores it on the task.

**Architecture:** Per-side stamp columns + SECURITY DEFINER RPCs (`resolve_task`/`unresolve_task`) keep the existing terminal transition (`status='resolved'` / `completed_at`) as the single event all existing triggers key off. A `task_summary_outbox` + pg_net pulse + cron backstop (mirror of the email outbox) drives a new `summarize-task` edge function that calls OpenAI and posts into the same comment channel the ✅ marker targets.

**Tech Stack:** Postgres (plpgsql, pg_net, pg_cron, vault), Supabase edge functions (Deno), OpenAI Chat Completions, React + react-query + zustand frontend.

**Spec:** `docs/superpowers/specs/2026-07-16-dual-resolve-task-summary-design.md` (approved 2026-07-16).

## Global Constraints

- NEVER run the whole vitest suite (it targets production Supabase). Run only the test files you created: `npx vitest run <file>`.
- CONCURRENT SESSIONS share this checkout: before editing, `git status` your target files; commit ONLY your files by explicit pathspec; never `git add -A`; do NOT push (push happens once, from the main session, at feature end).
- Migrations are FILES ONLY for implementer subagents — committed but NOT applied. Prod apply/verify happens in the MAIN session via Supabase MCP after owner go-ahead (tasks marked MAIN SESSION).
- No secrets in code, docs, or migrations — env/vault names only: `OPENAI_API_KEY`, `OPENAI_MODEL` (optional), `TASK_SUMMARY_SECRET`, vault `task_summary_secret`, vault `project_url` (exists).
- `npm run build` (tsc -b + eslint max-warnings=0) must pass for your files; pre-existing errors from other workstreams are reported, not fixed.
- Greek UI copy exact strings are given in each task — use them verbatim.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- prod project ref: `xujlrclyzxrvxszepquy`.

---

### Task 1: Migration — dual-resolve columns, guard, RPCs, confirm-pending notification

**Files:**
- Create: `supabase/migrations/20260716200000_dual_resolve.sql`
- Reference (read, do not modify): `supabase/migrations/20260512000001_assigned_tasks.sql` (stamp trigger lines 83-99, notif inserts 108-177), `supabase/migrations/20260610000001_user_tasks_assignee.sql`, `supabase/migrations/20260625160000_task_collaboration.sql` (notif payload shape).

**Interfaces (produces):**
- Columns on BOTH `user_tasks` and `assigned_tasks`: `creator_resolved_at timestamptz`, `creator_resolved_by uuid`, `assignee_resolved_at timestamptz`, `assignee_resolved_by uuid`, `summary text`.
- `public.resolve_task(p_kind text, p_task_id uuid) returns jsonb` — jsonb `{closed: bool, your_side: 'creator'|'assignee'|'both', awaiting: uuid|null}`.
- `public.unresolve_task(p_kind text, p_task_id uuid) returns void`.
- Notification type string: `'task_confirm_pending'`.

- [ ] **Step 1: Write the migration file** with this exact content (rollback SQL in the header comment):

```sql
-- Dual-sided task resolve (spec docs/superpowers/specs/2026-07-16-dual-resolve-task-summary-design.md)
-- ROLLBACK:
--   drop function if exists public.resolve_task(text, uuid), public.unresolve_task(text, uuid);
--   drop trigger if exists user_tasks_guard_terminal on public.user_tasks;
--   drop trigger if exists assigned_tasks_guard_terminal on public.assigned_tasks;
--   drop trigger if exists user_tasks_clear_stamps on public.user_tasks;
--   drop function if exists public.tasks_guard_terminal(), public.user_tasks_clear_stamps();
--   (restore assigned_tasks_stamp_resolved from 20260512000001) 
--   alter table public.user_tasks drop column if exists creator_resolved_at, drop column if exists creator_resolved_by,
--     drop column if exists assignee_resolved_at, drop column if exists assignee_resolved_by, drop column if exists summary;
--   alter table public.assigned_tasks drop column if exists creator_resolved_at, drop column if exists creator_resolved_by,
--     drop column if exists assignee_resolved_at, drop column if exists assignee_resolved_by, drop column if exists summary;

alter table public.user_tasks
  add column if not exists creator_resolved_at timestamptz,
  add column if not exists creator_resolved_by uuid,
  add column if not exists assignee_resolved_at timestamptz,
  add column if not exists assignee_resolved_by uuid,
  add column if not exists summary text;

alter table public.assigned_tasks
  add column if not exists creator_resolved_at timestamptz,
  add column if not exists creator_resolved_by uuid,
  add column if not exists assignee_resolved_at timestamptz,
  add column if not exists assignee_resolved_by uuid,
  add column if not exists summary text;

-- Direct open->terminal updates are blocked; only resolve_task()/unresolve_task()
-- (which set this transaction-local GUC) may flip the terminal state. Reopen
-- (resolved->open) stays allowed for the existing admin flow.
create or replace function public.tasks_guard_terminal() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.task_resolve_rpc', true), '') <> '1' then
    raise exception 'use resolve_task() to resolve tasks';
  end if;
  return new;
end $$;

create trigger assigned_tasks_guard_terminal
  before update on public.assigned_tasks
  for each row when (old.status = 'open' and new.status = 'resolved')
  execute function public.tasks_guard_terminal();

create trigger user_tasks_guard_terminal
  before update on public.user_tasks
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function public.tasks_guard_terminal();

-- Reopen clears both side-stamps (extends the existing assigned_tasks stamp
-- trigger; adds the user_tasks equivalent).
create or replace function public.assigned_tasks_stamp_resolved() returns trigger
language plpgsql as $$
begin
  if old.status = 'open' and new.status = 'resolved' then
    new.resolved_at := now();
    new.resolved_by_user_id := coalesce(auth.uid(), new.resolved_by_user_id);
  elsif old.status = 'resolved' and new.status = 'open' then
    new.resolved_at := null;
    new.resolved_by_user_id := null;
    new.creator_resolved_at := null;  new.creator_resolved_by := null;
    new.assignee_resolved_at := null; new.assignee_resolved_by := null;
  end if;
  return new;
end $$;

create or replace function public.user_tasks_clear_stamps() returns trigger
language plpgsql as $$
begin
  new.creator_resolved_at := null;  new.creator_resolved_by := null;
  new.assignee_resolved_at := null; new.assignee_resolved_by := null;
  return new;
end $$;

create trigger user_tasks_clear_stamps
  before update on public.user_tasks
  for each row when (old.completed_at is not null and new.completed_at is null)
  execute function public.user_tasks_clear_stamps();

create or replace function public.resolve_task(p_kind text, p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_creator uuid; v_assignee uuid;
  v_c_at timestamptz; v_a_at timestamptz;
  v_title text; v_source text; v_ptype text; v_pid uuid;
  v_is_creator boolean; v_is_assignee boolean;
  v_first_stamp boolean := false;
  v_other uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_admin := coalesce((select is_admin from profiles where user_id = v_uid), false);
  perform set_config('app.task_resolve_rpc', '1', true);

  if p_kind = 'assigned' then
    select created_by_user_id, assignee_user_id, creator_resolved_at, assignee_resolved_at,
           title, source_code,
           case when deal_id is not null then 'deal' else 'job' end,
           coalesce(deal_id, job_id)
      into v_creator, v_assignee, v_c_at, v_a_at, v_title, v_source, v_ptype, v_pid
      from assigned_tasks where id = p_task_id and status = 'open' for update;
  elsif p_kind = 'user' then
    select created_by, user_id, creator_resolved_at, assignee_resolved_at,
           title, null, null, null
      into v_creator, v_assignee, v_c_at, v_a_at, v_title, v_source, v_ptype, v_pid
      from user_tasks where id = p_task_id and completed_at is null for update;
  else
    raise exception 'bad kind %', p_kind;
  end if;
  if v_assignee is null and v_creator is null then raise exception 'task not found or already closed'; end if;

  v_is_creator  := coalesce(v_uid = v_creator, false);
  v_is_assignee := coalesce(v_uid = v_assignee, false);
  if not (v_is_creator or v_is_assignee or v_admin) then raise exception 'not a party'; end if;

  -- Admin force-close and self-tasks stamp both sides; otherwise stamp own side.
  if v_admin and not (v_is_creator or v_is_assignee) then
    v_c_at := coalesce(v_c_at, now()); v_a_at := coalesce(v_a_at, now());
    v_first_stamp := false;
  else
    if v_is_creator  and v_c_at is null then v_c_at := now(); v_first_stamp := true; end if;
    if v_is_assignee and v_a_at is null then v_a_at := now(); v_first_stamp := true; end if;
  end if;

  if p_kind = 'assigned' then
    update assigned_tasks set
      creator_resolved_at  = v_c_at,
      creator_resolved_by  = case when v_c_at is not null and creator_resolved_by  is null then v_uid else creator_resolved_by  end,
      assignee_resolved_at = v_a_at,
      assignee_resolved_by = case when v_a_at is not null and assignee_resolved_by is null then v_uid else assignee_resolved_by end,
      status = case when v_c_at is not null and v_a_at is not null then 'resolved' else status end
    where id = p_task_id;
  else
    update user_tasks set
      creator_resolved_at  = v_c_at,
      creator_resolved_by  = case when v_c_at is not null and creator_resolved_by  is null then v_uid else creator_resolved_by  end,
      assignee_resolved_at = v_a_at,
      assignee_resolved_by = case when v_a_at is not null and assignee_resolved_by is null then v_uid else assignee_resolved_by end,
      completed_at = case when v_c_at is not null and v_a_at is not null then now() else completed_at end
    where id = p_task_id;
  end if;

  -- First one-sided stamp on a two-party task -> notify the other party.
  if v_first_stamp and not (v_c_at is not null and v_a_at is not null) and v_creator <> v_assignee then
    v_other := case when v_is_creator then v_assignee else v_creator end;
    insert into notifications (user_id, type, payload) values (v_other, 'task_confirm_pending',
      jsonb_build_object('task_kind', p_kind || '_task', 'task_id', p_task_id, 'title', v_title,
                         'author_id', v_uid, 'source_code', v_source,
                         'parent_type', v_ptype, 'parent_id', v_pid));
  end if;

  return jsonb_build_object(
    'closed', (v_c_at is not null and v_a_at is not null),
    'your_side', case when v_is_creator and v_is_assignee then 'both'
                      when v_is_creator then 'creator' else 'assignee' end,
    'awaiting', case when v_c_at is null then v_creator when v_a_at is null then v_assignee else null end);
end $$;

create or replace function public.unresolve_task(p_kind text, p_task_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_kind = 'assigned' then
    update assigned_tasks set
      creator_resolved_at  = case when created_by_user_id  = v_uid then null else creator_resolved_at  end,
      creator_resolved_by  = case when created_by_user_id  = v_uid then null else creator_resolved_by  end,
      assignee_resolved_at = case when assignee_user_id    = v_uid then null else assignee_resolved_at end,
      assignee_resolved_by = case when assignee_user_id    = v_uid then null else assignee_resolved_by end
    where id = p_task_id and status = 'open'
      and (created_by_user_id = v_uid or assignee_user_id = v_uid);
  elsif p_kind = 'user' then
    update user_tasks set
      creator_resolved_at  = case when created_by = v_uid then null else creator_resolved_at  end,
      creator_resolved_by  = case when created_by = v_uid then null else creator_resolved_by  end,
      assignee_resolved_at = case when user_id    = v_uid then null else assignee_resolved_at end,
      assignee_resolved_by = case when user_id    = v_uid then null else assignee_resolved_by end
    where id = p_task_id and completed_at is null
      and (created_by = v_uid or user_id = v_uid);
  else
    raise exception 'bad kind %', p_kind;
  end if;
end $$;

revoke all on function public.resolve_task(text, uuid) from public, anon;
revoke all on function public.unresolve_task(text, uuid) from public, anon;
grant execute on function public.resolve_task(text, uuid) to authenticated;
grant execute on function public.unresolve_task(text, uuid) to authenticated;
```

- [ ] **Step 2: Grep for other direct terminal writers** the guard would break: `grep -rn "status: *'resolved'\|status='resolved'\|completed_at" src/ supabase/migrations/ --include=*.ts --include=*.tsx --include=*.sql | grep -v test`. Expected writers: the four resolve entry points named in Task 3/4 (they migrate to the RPC) and reopen flows (unaffected — opposite direction). If you find ANOTHER writer (e.g. a bulk/cron path), STOP and report DONE_WITH_CONCERNS naming it.
- [ ] **Step 3: Commit** `git add supabase/migrations/20260716200000_dual_resolve.sql && git commit -m "feat(tasks): DB — dual-sided resolve (side stamps, guard, resolve_task/unresolve_task RPCs)"` (+ trailer).

### Task 2 (MAIN SESSION): Apply migration 1 to prod + verify

- [ ] Apply via MCP `apply_migration` (name `dual_resolve`) after owner go-ahead.
- [ ] Verify: columns exist on both tables; `resolve_task` blocks non-party; direct `update assigned_tasks set status='resolved'` as admin errors with `use resolve_task()`; RPC self-task closes in one call; two-party first call returns `closed:false` + inserts `task_confirm_pending` notification; second call from the other party closes and fires the existing ✅ auto-comment exactly once. Test rows created on a scratch task and cleaned up.

### Task 3: Frontend — pure gating helpers (TDD) + RPC hooks

**Files:**
- Create: `src/features/tasks/dualResolve.ts`, `src/features/tasks/dualResolve.test.ts`, `src/features/tasks/hooks/useResolveTask.ts`
- Reference: `src/features/tasks/taskCard.ts` (relationOf at :36-40), `src/features/assigned_tasks/hooks/useResolveAssignedTask.ts` (hook shape + invalidations)

**Interfaces (produces):**
- `type DualResolveState = { creatorResolvedAt: string | null; assigneeResolvedAt: string | null; creatorId: string | null; assigneeId: string | null; closed: boolean }`
- `resolveAction(s: DualResolveState, uid: string | null, isAdmin: boolean): 'resolve' | 'confirm_close' | 'withdraw' | 'force_close' | null` — what the primary button does for this user (`null` = hidden/closed).
- `awaitingLabelParty(s: DualResolveState): 'creator' | 'assignee' | null` — who is still pending (for the badge).
- `useResolveTask()` / `useUnresolveTask()` — react-query mutations calling `supabase.rpc('resolve_task'|'unresolve_task', { p_kind, p_task_id })`, invalidating `['tasks']`, `['assigned_tasks']`, `['user_tasks']`, `['comments']`, `['notifications']` (match the invalidation keys used in `useResolveAssignedTask.ts`).

- [ ] **Step 1: Write failing tests** in `dualResolve.test.ts` covering: non-party → null; assignee with nothing stamped → 'resolve'; assignee when creator already stamped → 'confirm_close'; user who already stamped (not closed) → 'withdraw'; admin non-party → 'force_close'; closed → null; self-task (creatorId===assigneeId) with nothing stamped → 'resolve'; awaitingLabelParty for each half-state and null when none/both.
- [ ] **Step 2: Run** `npx vitest run src/features/tasks/dualResolve.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `dualResolve.ts`:

```ts
export type DualResolveState = {
  creatorResolvedAt: string | null;
  assigneeResolvedAt: string | null;
  creatorId: string | null;
  assigneeId: string | null;
  closed: boolean;
};

export function resolveAction(
  s: DualResolveState, uid: string | null, isAdmin: boolean,
): 'resolve' | 'confirm_close' | 'withdraw' | 'force_close' | null {
  if (s.closed || !uid) return null;
  const isCreator = uid === s.creatorId;
  const isAssignee = uid === s.assigneeId;
  if (!isCreator && !isAssignee) return isAdmin ? 'force_close' : null;
  const mineStamped = (isCreator && !!s.creatorResolvedAt) || (isAssignee && !!s.assigneeResolvedAt);
  if (mineStamped) return 'withdraw';
  const otherStamped = isCreator ? !!s.assigneeResolvedAt : !!s.creatorResolvedAt;
  const selfTask = s.creatorId === s.assigneeId;
  return otherStamped || selfTask ? 'confirm_close' : 'resolve';
}

export function awaitingLabelParty(s: DualResolveState): 'creator' | 'assignee' | null {
  if (s.closed) return null;
  if (s.creatorResolvedAt && !s.assigneeResolvedAt) return 'assignee';
  if (s.assigneeResolvedAt && !s.creatorResolvedAt) return 'creator';
  return null;
}
```

(Note: self-task with nothing stamped returns `'confirm_close'`? No — `otherStamped` is false and `selfTask` true → returns `'confirm_close'`; the test in Step 1 expects `'resolve'` for self-tasks. Make the tests authoritative: for self-tasks return `'resolve'` — adjust the last line to `return otherStamped && !selfTask ? 'confirm_close' : 'resolve';` and keep the behavior identical either way at the RPC level. The button label for self-tasks stays plain «Resolve».)

- [ ] **Step 4: Run tests** — expect PASS. Fix code (not tests) until green.
- [ ] **Step 5: Implement `useResolveTask.ts`** exporting `useResolveTask` and `useUnresolveTask` (both take `{ kind: 'user' | 'assigned'; id: string }`), mirroring the mutation/invalidation structure of `useResolveAssignedTask.ts` but calling `supabase.rpc(...)`.
- [ ] **Step 6: Build + commit** your three files: `feat(tasks): dual-resolve gating helpers + resolve/unresolve RPC hooks`.

### Task 4: Frontend — wire the 4 entry points, badges, notification presenter

**Files:**
- Modify: `src/features/tasks/hooks/useTaskBoardActions.ts` (:24-38), `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx` (Resolve button ~:138-140), `src/features/assigned_tasks/AssignedTasksTab.tsx` (:48 gate, :97-110 inline resolve), `src/features/tasks/UserTaskDetailDialog.tsx` (:66-77), `src/features/tasks/taskCard.ts` (add side-stamps to the card mapping), `src/features/notifications/notification-presenters.tsx` (new `task_confirm_pending` presenter reusing `readPath`), the tasks board card component (badge), i18n `src/i18n/locales/{en,el}/tasks.json`.

**Interfaces (consumes):** Task 3's `resolveAction`, `awaitingLabelParty`, `useResolveTask`, `useUnresolveTask`. Select side-stamp columns everywhere the task queries fetch rows (add `creator_resolved_at, creator_resolved_by, assignee_resolved_at, assignee_resolved_by, summary` to the selects feeding these views).

**Behavior (exact copy strings):**
- Button labels: en `Resolve` / `Confirm & close` / `Withdraw ✓`; el `Επίλυση` / `Επιβεβαίωση & κλείσιμο` / `Αναίρεση ✓`.
- Badge on half-resolved cards & dialog status row: en `Awaiting confirmation — {{name}}`; el `Αναμονή επιβεβαίωσης — {{name}}` (name = the pending party's display name, resolved via the existing owners/mentionable-users directory hooks already used on those views).
- Notification presenter text: en `{{author}} resolved “{{title}}” — confirm to close`; el `Ο/Η {{author}} έκανε επίλυση στο «{{title}}» — επιβεβαίωσε για να κλείσει`.
- Kanban: `isDraggable` extends to `relation === 'delegated'`; `resolveDrag` to the Resolved lane calls `resolveTask` and, when the response has `closed:false`, shows the existing toast mechanism with el `Η πλευρά σου καταχωρήθηκε — αναμονή επιβεβαίωσης` (en `Your side is recorded — awaiting confirmation`) and the card STAYS in its column (list refetch keeps it out of Resolved because terminal state is unchanged).
- Resolved dialogs show `summary` (when non-null) in a read-only block titled el `Σύνοψη` / en `Summary`.

- [ ] Step 1: taskCard mapping + selects; Step 2: replace the four write paths with the hooks + `resolveAction` gating; Step 3: badge + dialog states + summary block; Step 4: presenter + i18n keys; Step 5: `npm run build` for your files; Step 6: commit `feat(tasks): dual-resolve UI — stamp/confirm/withdraw, pending badges, confirm-pending notifications`.

### Task 5: Migration — summary outbox, pulse, cron, channel-target helper

**Files:**
- Create: `supabase/migrations/20260716210000_task_summary_outbox.sql`
- Reference: `supabase/migrations/20260625150002_email_instant_pulse.sql` (pulse), `20260716100000_ads_social_channels_unread.sql:92-129` (routing CASE to reproduce), `claim_email_outbox` definition.

**Interfaces (produces):**
- Table `task_summary_outbox(id uuid pk default gen_random_uuid(), task_kind text check in ('user','assigned'), task_id uuid not null, status text check in ('pending','sending','sent','failed') default 'pending', attempts int not null default 0, last_error text, created_at timestamptz default now(), sent_at timestamptz)`.
- `public.claim_task_summaries(p_limit int) returns setof task_summary_outbox` — recovers stale `sending` rows (>5 min) to `pending`, then claims `pending` rows `for update skip locked`, sets `sending`, `attempts = attempts + 1`; rows with `attempts >= 5` flip to `failed` instead of being returned.
- `public.task_comment_target(p_kind text, p_task_id uuid) returns table(parent_type text, parent_id uuid)` — assigned: deal→(`deal`, deal_id); job by service_type: web_dev→`deal_dev`, web_seo/local_seo/ai_seo→`deal_seo`, ads→`deal_ads`, social_media→`deal_social` (all with the job's deal_id), else→(`job`, job_id); user: client_id→(`client`,client_id) else lead_id→(`lead`,lead_id) else deal_id→(`deal`,deal_id) else job_id→(`job`,job_id) else no row. NOTE IN A SQL COMMENT: this intentionally duplicates the CASE in `assigned_tasks_comment_on_resolve` (20260716100000) — keep the two in sync.
- AFTER-UPDATE enqueue triggers on both task tables (terminal transition WHEN clauses identical to Task 1's guard triggers) + AFTER INSERT statement-level pulse on `task_summary_outbox` doing `net.http_post` to `<vault:project_url>/functions/v1/summarize-task` with header `Authorization: Bearer <vault:task_summary_secret>` and body `{"drain": true}`, wrapped in `begin…exception when others then null`.
- pg_cron job `task-summary-drain` every 10 minutes posting the same drain call (mirror `20260602000002_email_drain_cron.sql`).

- [ ] Step 1: write the migration (full SQL, following the referenced files' exact patterns — vault reads identical to `email_outbox_pulse`); Step 2: commit `feat(tasks): DB — task_summary_outbox + pulse + cron + comment-target helper`.

### Task 6: Edge function `summarize-task`

**Files:**
- Create: `supabase/functions/summarize-task/index.ts`, `supabase/functions/summarize-task/prompt.ts`
- Modify: `supabase/config.toml` (add `[functions.summarize-task] verify_jwt = false` next to the send-email entry)
- Reference: `supabase/functions/send-email/index.ts` (bearer auth via `timingSafeEqual` ../_shared/timing.ts, admin client, drain loop shape).

**Interfaces (consumes):** `claim_task_summaries`, `task_comment_target`, env `TASK_SUMMARY_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`).

**Behavior per claimed row:**
1. Load task (`user_tasks` or `assigned_tasks` by kind) + its `task_comments` ordered by `created_at asc`, author names from `profiles` (`user_id in (...)` → `full_name`/`email`).
2. Zero comments → mark row `sent` (no LLM, no comment).
3. `prompt.ts` exports `buildSummaryInput(task, comments): string` — header `Task: <title>\nΠεριγραφή: <description|notes>\n` then lines `«<Όνομα> (<dd/MM HH:mm>): <body>»` oldest-first, truncated from the OLDEST side to ≤ 12000 characters (prepend `…(παλαιότερα σχόλια παραλείφθηκαν)` when truncated) — pure function.
4. POST `https://api.openai.com/v1/chat/completions` `{ model, temperature: 0.2, max_tokens: 400, messages: [{role:'system', content: SYSTEM_PROMPT}, {role:'user', content: input}] }`. `SYSTEM_PROMPT` (exact): `Είσαι βοηθός αρχειοθέτησης σε CRM. Γράψε σύντομη τεκμηριωμένη σύνοψη (3-5 γραμμές, ελληνικά) της συζήτησης ενός task: τι ζητήθηκε, τι έγινε, τι αποφασίστηκε, τυχόν εκκρεμότητες. Χωρίς χαιρετισμούς, χωρίς αυτούσια παραθέματα, χωρίς ονόματα σε κάθε γραμμή.`
5. Success → update the task row's `summary`; call `task_comment_target`; when it returns a row, insert into `comments`: `parent_type`, `parent_id`, `author_id` = final resolver (assigned: `resolved_by_user_id`; user: `coalesce(assignee_resolved_by, creator_resolved_by)`), `body` = `🤖 Σύνοψη task: «<title>»\n<summary>`, `mentioned_user_ids: []`, `task_key` = `'<kind>:<id>'`. Mark outbox `sent` + `sent_at`.
6. Any failure → set outbox `status='pending'`, `last_error` (claim already bumped attempts; ≥5 becomes `failed` on next claim). Function never throws to the caller loop.

- [ ] Step 1: implement both files (auth: 401 unless bearer equals `TASK_SUMMARY_SECRET` via `timingSafeEqual`; only `{drain:true}` mode); Step 2: `deno check` if available, else careful read-through + `npm run build` untouched; Step 3: commit `feat(tasks): summarize-task edge function (OpenAI resolve summaries)`.

### Task 7 (MAIN SESSION): Secrets, apply migration 5, deploy, e2e verify

- [ ] Set secrets (values never in transcript/docs): `TASK_SUMMARY_SECRET` (generate), `OPENAI_API_KEY` (owner-provided key) via `supabase secrets set` / dashboard; vault insert `task_summary_secret` (same value as TASK_SUMMARY_SECRET).
- [ ] Apply migration `task_summary_outbox` via MCP; deploy `summarize-task` via MCP `deploy_edge_function`.
- [ ] E2E on prod with test accounts (admin + sales rep, read-only-ish; test tasks cleaned up): rep resolves → badge + notif; creator confirms → close; ✅ + 🤖 comments land in the correct channel; `summary` stored; zero-comment task → no 🤖 comment; unresolve flow; self-task single-stamp; outbox row lifecycle pending→sent.
- [ ] Final whole-branch review (subagent-driven-development), `npm run build` green, single push to main, owner reminder: **rotate the OpenAI key shared in chat** and update the secret.

---

## Self-review notes

- Spec coverage: schema §1→T1, RPCs §2→T1/T2, UI §3→T3/T4, pipeline §4→T5/T6/T7, secrets §5→T7, edge cases exercised in T2/T7 verification. Reopen-clears-stamps covered in T1. No gaps found.
- resolveAction self-task ambiguity fixed inline (tests authoritative: 'resolve').
- Type/name consistency: `resolve_task(p_kind,p_task_id)` used identically in T1/T3/T4; outbox names identical in T5/T6.
