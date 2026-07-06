# Sales lead-linked tasks — design

**Date:** 2026-07-06
**Status:** Approved (picker scope, lead visibility, assignee filter all confirmed by owner)

## Problem

Sales reps create personal tasks (`user_tasks`) but cannot link them to the records they
actually work with — **leads**. The task dialog's picker (`ClientPicker`) searches the
`clients` table only, which holds deal/accounting clients, so sales see "deals" they don't
own and can't find their leads at all. Separately, the "Assign to" dropdown lists the full
staff directory (including technical teams); sales should only allocate tasks to other
sales, admins, and accounting.

## Decisions (confirmed)

1. **Picker scope:** sales-group users (non-admin) get a **Lead picker** instead of the
   Client picker. Admins/accounting keep the clients picker unchanged.
2. **Lead task visibility:** lead name/code shown on task board cards (chip links to
   `/leads/:id`) and in the task detail dialog; the Lead detail page gets a **Tasks** tab
   mirroring the client Tasks tab, with "New task" pre-filling the lead.
3. **Assignee filter:** for sales users the Assign-to dropdown is filtered client-side to
   admins + `sales` + `accounting` group members. Other roles keep the full list.

## Data model

New nullable column on `public.user_tasks`, mirroring how `client_id` was added
(migration `20260623100000_user_tasks_client_id.sql`):

```sql
alter table public.user_tasks
  add column if not exists lead_id uuid references public.leads(id) on delete set null;
create index if not exists user_tasks_lead_id
  on public.user_tasks (lead_id) where lead_id is not null;
```

- A task links to **either** a client or a lead (UI only ever sets one; no CHECK needed —
  both nullable, and a dual-link row would be harmless).
- No RLS change: the column inherits `user_tasks` policies (assignee/creator/admin).
  Cross-user assignment already allowed by existing insert/update policies.
- No change to `assigned_tasks` (deal/job tasks are out of scope).
- Rollback: `drop index if exists public.user_tasks_lead_id; alter table public.user_tasks drop column if exists lead_id;`

## Frontend

### LeadPicker (`src/features/leads/LeadPicker.tsx`)

Mirror of `ClientPicker` (typeahead, ≥2 chars, 200 ms debounce):

- `useLeadSearch` hook: `from('leads').select('id, title, code, company_name')`
  `.eq('archived', false)` `.or(title/company_name/code/business_profile_name ilike)`
  limit 20, ordered by title. Leads RLS scopes results for free (reps own-only,
  tvogiatzi/admins all).
- Renders lead `title` + mono `code` chip, like ClientPicker renders name + code.
- When given a value with an empty name (edit mode only has `lead_id`), fetches the lead
  title by id so the chip isn't blank.
- Exports `PickedLead = { id: string; name: string }`.

### TaskDialog (`src/features/home/TaskDialog.tsx`)

- Mode selection: **lead mode** when editing a task with `lead_id`, when `defaultLead`
  prop is provided (lead Tasks tab), or when the current user is sales
  (`groupCodes.includes('sales') && !isAdmin`) creating/editing a task without
  `client_id`. Otherwise **client mode** (unchanged).
- Lead mode renders `LeadPicker`; save writes `lead_id` (and `client_id: null`); client
  mode writes `client_id` (and leaves `lead_id` untouched/null).
- New optional prop `defaultLead?: PickedLead | null`.
- **Assign-to filter:** when the user is sales (non-admin), filter `useMentionableUsers()`
  results to `o.is_admin || o.group_codes.includes('sales') || o.group_codes.includes('accounting')`.
- `useUpsertTask` input gains `lead_id?: string | null`; invalidates `lead-tasks` too.

### Task board / detail display

- `useTaskBoardData` user-task select becomes
  `*, lead:leads(id, title, code)` (client join not needed — client name was never shown
  for user tasks). If lead RLS hides the lead from the viewer, the join is null and the
  card falls back to today's "Personal" chip.
- `taskCard.ts`: `userTaskToCard` sets `sourceCode = lead.code`, `link = /leads/<id>`,
  and new field `leadName` (kept separate from `clientName` so the detail dialog can
  label it "Lead"). `UserTaskRow` type widened with the optional joined `lead`.
- `UserTaskDetailDialog`: pushes a "Lead" meta row when `card.leadName` present
  (`tasks_page.lead_label` in common ns).
- `useClientTasks` (client Tasks tab) unchanged.

### Lead detail page Tasks tab

- `LeadTasksTab` (`src/features/leads/LeadTasksTab.tsx`): mirror of `ClientTasksTab` but
  queries only `user_tasks` by `lead_id` (assigned_tasks have no lead link) via new
  `useLeadTasks` hook; "New task" opens `TaskDialog` with `defaultLead`.
- `LeadDetailPage`: new "Tasks" tab trigger + content between Attachments and Activity.
- Visibility follows `user_tasks` RLS: a rep sees tasks they created/are assigned;
  admins see all.

### i18n

- `common.json` (en/el): `lead_picker.{label,search_placeholder,clear,no_results}`,
  `tasks_page.lead_label`.
- `leads.json` (en/el): `tabs.tasks`, `tasks_tab.{open,resolved,new,empty}`.

### Query keys

`leadSearch(term)`, `leadTasks(leadId)` added to `src/lib/queryKeys.ts`;
`useUpsertTask`/`useDeleteTask` invalidate `['lead-tasks']`.

## Types

`src/types/supabase.ts`: hand-add `lead_id` to `user_tasks` Row/Insert/Update + the
`user_tasks_lead_id_fkey` relationship (additive; matches live schema after migration).

## Testing

- Unit (vitest): mode-selection helper (sales→lead mode, admin→client mode, edit
  respects existing link), assignee-filter helper (sales sees admins+sales+accounting
  only; admin sees all), `userTaskToCard` lead mapping (code chip, link, leadName),
  LeadPicker render/select (mirror ClientPicker.test).
- `npm run build` (strict tsc + eslint) must pass.
- Live verify: as a sales rep — create task linked to own lead, see it on lead Tasks tab
  and board card chip; assignee dropdown shows no technical staff.

## Changes / Revert

- **DB:** one additive migration `20260706..._user_tasks_lead_id.sql` (rollback SQL in
  file header, above).
- **Frontend:** new files `LeadPicker.tsx`, `useLeadSearch.ts`, `LeadTasksTab.tsx`,
  `useLeadTasks.ts`; edits to `TaskDialog.tsx`, `useUpsertTask.ts`, `useDeleteTask.ts`,
  `useTaskBoardData.ts`, `taskCard.ts`, `UserTaskDetailDialog.tsx`, `LeadDetailPage.tsx`,
  `queryKeys.ts`, locale JSONs, `types/supabase.ts`. Revert = git revert of the feature
  commits; DB column is safe to leave or drop per rollback SQL.

## Out of scope

- `assigned_tasks` (deal/job tasks), notifications, task RLS changes, combined
  lead+client picker for admins, Meta/intake flows.
