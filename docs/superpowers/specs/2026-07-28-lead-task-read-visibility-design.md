# Lead tasks & conversations — read visibility for lead-visible users — design

Date: 2026-07-28
Status: approved, not yet implemented

## Goal

A sales rep who can open a lead must see **all** tasks linked to that lead and the **full conversation thread** (including in-thread file attachments) of each, even when they are neither the task's creator nor its assignee — e.g. an admin↔tech task about their lead. Read-only: writing, resolving, and editing stay parties-only.

## Owner decisions (2026-07-28)

- **Audience:** lead-visible users — the lead's owning sales rep and admins. NOT all sales reps, NOT all staff. The own-only leads visibility rule stays intact: a rep learns nothing about another rep's leads.
- **Access level:** read-only. Only the task's parties may comment, resolve, or edit. (Matches the accounting-on-deals precedent, migration `20260707130000_assigned_tasks_accounting_select.sql`.)
- **Approach A** chosen: widen the RLS read policies directly (one consistent rule; the lead Tasks tab already queries all tasks by `lead_id`, so cards appear automatically). Rejected: a dedicated security-definer read endpoint — every surface (tab, dialog, thread, attachments, realtime) would need parallel plumbing and the normal queries would still show an incomplete picture.

## Current state (the gap)

- `leads` SELECT (`20260618000001_leads_own_only_for_sales.sql`): admin or `owner_user_id = auth.uid()`.
- `user_tasks` SELECT (`20260610000001_user_tasks_assignee.sql`): assignee, creator, or admin. A lead-linked task between two other people is invisible to the lead's owner.
- `task_comments` SELECT/INSERT (`20260625160000_task_collaboration.sql`): `is_task_party()` — parties or admin, both directions.
- `comment_attachments` SELECT (`20260723120000_comment_attachments.sql`): task-comment rows gated by `is_task_party()` of the parent.
- Lead **general** comments (`comments`, `parent_type='lead'`) are already open to all staff — no change needed.

`is_task_party()` already includes `current_user_is_admin()`, so the only missing audience is the lead-owning rep.

## Architecture

### DB — one migration `20260728120000_lead_task_read_visibility.sql`

1. **New helper** `public.can_read_task(p_user_task uuid, p_assigned_task uuid) returns boolean`
   — `stable security definer set search_path = public`:

   ```sql
   select public.is_task_party(p_user_task, p_assigned_task)
     or (p_user_task is not null and exists (
           select 1 from public.user_tasks ut
           join public.leads l on l.id = ut.lead_id
           where ut.id = p_user_task
             and l.owner_user_id = auth.uid()));
   ```

   Per grant-boundary policy: `revoke all ... from public; grant execute ... to authenticated;`.

2. **`user_tasks` SELECT** — drop + recreate `user_tasks_select` with one extra branch:

   ```sql
   or (lead_id is not null and exists (
         select 1 from public.leads l
         where l.id = user_tasks.lead_id and l.owner_user_id = auth.uid()))
   ```

   INSERT/UPDATE/DELETE policies unchanged.

3. **`task_comments` SELECT** — drop + recreate `task_comments_select` using
   `public.can_read_task(user_task_id, assigned_task_id)`. INSERT stays `is_task_party` (read-only for the rep).

4. **`comment_attachments` SELECT** — drop + recreate `comment_attachments_select`, replacing the
   `is_task_party(tc.user_task_id, tc.assigned_task_id)` call with `can_read_task(...)` in the
   task-comment branch. INSERT/DELETE unchanged.

Notes:
- `assigned_tasks` (deal tasks) visibility is untouched — including the existing accounting read-widening and its threads staying parties-only.
- Lead-linked tasks on **converted** leads keep their `lead_id` and owner, so visibility persists — intended.
- Perf: the lead Tasks tab filters `eq('lead_id', …)` and a partial index on `user_tasks(lead_id)` exists; the policy subqueries are pk/owner lookups.

### UI

1. **Lead Tasks tab** (`useLeadTasks` → `buildBoardCards` → `TaskKanbanCard`): cards for non-party tasks now arrive via RLS. Verify rendering when the viewer is neither assignee nor creator: the existing `canAct = relation === 'mine'` gate already hides action buttons; confirm `relation`/labels degrade sensibly for a non-party viewer (may need a small `relation: 'observer'`-style fallback rather than a code change of substance).
2. **User-task detail dialog** for a lead-linked task where the viewer is not a party: render the conversation thread **read-only** — no composer, no Start/Resolve/Edit/Delete. Mirror the `AssignedTaskDetailDialog` `isParty` pattern, but instead of the "participants only" placeholder, show the thread (RLS now permits reading it). Deal-task dialog behavior unchanged (accounting still sees the placeholder).
3. In-thread attachments render via the existing bubble fetch — no UI change beyond RLS.

Not changing: notifications (rep is never notified of others' task activity), 💬 unread badges (counts stay RLS-driven; whatever the rep can now read may count — acceptable), leads visibility, deal/job task visibility.

## Testing (TDD, per plan-step)

- **RLS harness SQL test** (jwt-claims technique from the task-audit recipe) proving:
  - rep sees a non-party task + its thread + a thread attachment on their OWN lead;
  - rep sees nothing for the same setup on ANOTHER rep's lead;
  - rep CANNOT insert into `task_comments` on a non-party task (read-only);
  - parties/admin behavior unchanged; accounting deal-task thread still hidden.
- **Vitest UI test** for the read-only dialog state (no composer/actions for non-party viewer). Caution: vitest runs against PROD — keep tests read-only or use the harness pattern.
- **Prod smoke** with a sales test account: open an own lead with a foreign task, see card + thread; verify another rep's lead stays invisible.

## Changes (for revert tracking)

- Migration `20260728120000_lead_task_read_visibility.sql` (helper + 3 recreated SELECT policies).
- UI: lead Tasks tab card fallback (if needed) + read-only mode in the user-task detail dialog.

## Revert

```sql
drop policy if exists user_tasks_select on public.user_tasks;
create policy user_tasks_select on public.user_tasks
  for select to authenticated
  using (auth.uid() = user_id or auth.uid() = created_by or public.current_user_is_admin());

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.is_task_party(user_task_id, assigned_task_id));

drop policy if exists comment_attachments_select on public.comment_attachments;
create policy comment_attachments_select on public.comment_attachments
  for select to authenticated
  using (
    comment_id is not null
    or exists (
      select 1 from public.task_comments tc
       where tc.id = comment_attachments.task_comment_id
         and public.is_task_party(tc.user_task_id, tc.assigned_task_id)));

drop function if exists public.can_read_task(uuid, uuid);
```

Plus `git revert` of the UI commit(s).
