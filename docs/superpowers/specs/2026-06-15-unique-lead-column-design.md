# "Unique Lead" Sales Column — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design)
**Author:** Marios (product owner) + Claude

## Goal

Add a new **Unique Lead** column to the **sales** kanban as the first column, move the
welcome-email trigger from lead creation to "lead enters Unique Lead", and lock the act of
moving a lead **into** Unique Lead to a single user (`mkifokeris@itdev.gr`).

## Decisions (locked)

- **Name:** `Unique Lead` (en) / `Μοναδικός Πελάτης` (el). Stage code: `unique_lead`.
- **Placement:** first column — `position = 5` (before New Lead at 10).
- **Who can move IN:** only `mkifokeris@itdev.gr` (user id `61b53075-398f-43a0-86f6-8bce177b669b`).
  He is himself an admin, so enforcement is by **specific identity with NO admin bypass**.
  `info@itdev.gr` (also admin) is intentionally blocked.
- **Lock scope:** only the *move IN* action is restricted. Moving a lead **out** of Unique Lead,
  and editing leads already in it, are unrestricted (subject to normal `move_stage`/`edit` perms).
  The column and its leads remain visible to everyone with sales `view`.
- **Default landing stage is unchanged:** new/Meta leads still arrive in **New Lead**. Unique Lead
  is the curated first column mkifokeris pulls qualified leads into.

## Architecture / Components

### 1. New stage (DB)
Insert one row into `public.pipeline_stages`:
`board='sales'`, `code='unique_lead'`, `display_names='{"en":"Unique Lead","el":"Μοναδικός Πελάτης"}'`,
`position=5`, `is_terminal=false`. The kanban sources stages from `pipeline_stages` (board=`sales`,
sorted by position), so the column renders automatically with no frontend list change.

### 2. Welcome email retiming (DB)
Modify trigger function `public.leads_email_automations`:
- **Remove** the INSERT-time `lead_welcome` enqueue.
- The welcome fires when a lead **enters** `unique_lead`:
  - In the stage-change (`new.stage_id is distinct from old.stage_id`) block: if `new_code='unique_lead'`
    and `email_automation_enabled('lead_welcome')` → `enqueue_lead_email(new.id,'lead_welcome','lead_welcome:'||new.id)`.
  - Also in the INSERT branch: if the resulting stage code is `unique_lead` (e.g. mkifokeris creates a
    lead directly there) and the automation is enabled → same enqueue.
- Dedupe key `lead_welcome:<lead_id>` ⇒ sent at most once per lead.
- `scheduled_confirm`, `won_welcome`, `won_next_steps`, and sequence start/stop logic are untouched.

Consequence: leads in **New Lead** (incl. Meta) receive **no** email until moved to Unique Lead.

### 3. Move-in lock (DB, data-driven, source of truth)
- Add column `public.pipeline_stages.restricted_to_user_id uuid null references auth.users(id)`.
  Set it to mkifokeris's id on the `unique_lead` row. `null` = unrestricted (all other stages).
- New trigger function `public.leads_enforce_stage_restriction()` + `BEFORE INSERT OR UPDATE` trigger
  on `public.leads`:
  - Fire only when the lead is **entering** a stage (INSERT with a stage, or UPDATE where
    `new.stage_id is distinct from old.stage_id`).
  - Look up `restricted_to_user_id` for `new.stage_id`. If it is non-null **and**
    `auth.uid() is distinct from restricted_to_user_id` → `raise exception` with a clear message
    (SQLSTATE `42501` insufficient_privilege). **No admin bypass.**
  - Moving OUT (`old` was restricted, `new` is not) is allowed.
- Trigger ordering: this restriction trigger must see the final `stage_id`. The existing
  `leads_set_default_stage` (sets default when null) and `leads_email_automations` must not conflict —
  name the restriction trigger so it runs after defaulting but its decision only depends on `new.stage_id`.

### 4. Frontend
- `usePipelineStages` (and its row type) expose `restricted_to_user_id: string | null`.
- A small helper: a stage is *blocked for the current user* when
  `stage.restricted_to_user_id && stage.restricted_to_user_id !== currentUserId`.
- `SalesKanbanPage.onDragEnd`: if the drop target stage is blocked → do **not** call the mutation;
  show a toast: `Only Manolis can move leads into Unique Lead` (i18n key). Allowed users proceed as today.
- `LeadDetailPage` stage `<select>`: same guard before calling `moveStage`.
- Visual affordance: 🔒 indicator on the Unique Lead column header when blocked for the viewer; the
  column still renders and shows its leads (visibility is not restricted).
- The DB trigger is the real guard; the UI guard only prevents a raw 42501 error reaching the user.

## Data Flow
New lead (manual/Meta) → INSERT → defaults to New Lead → **no email**. mkifokeris drags it to
Unique Lead → restriction trigger allows (auth.uid()=his id) → `leads_email_automations` enqueues
`lead_welcome` → drain sends it. A non-authorized user attempting the same drag is blocked in the UI
(toast) and, if bypassed, rejected by the trigger (42501).

## Error Handling
- Trigger raises `42501` with message naming the column; UI maps any failed move to a friendly toast.
- Welcome enqueue is guarded by `email_automation_enabled('lead_welcome')` and the `lead_welcome:<id>`
  dedupe so retries/re-entries never double-send.

## Testing
- **DB (SQL, run against prod after apply or a scratch run):**
  - non-mkifokeris UPDATE leads.stage_id → unique_lead ⇒ rejected (42501).
  - mkifokeris move-in ⇒ allowed; `email_outbox` gets one `lead_welcome:<id>` row.
  - INSERT into New Lead ⇒ **no** `lead_welcome` row.
  - move OUT of unique_lead by a non-restricted user ⇒ allowed.
- **Frontend (Vitest + RTL):**
  - Unique Lead renders as the first sales column.
  - Drop into Unique Lead by a non-authorized user ⇒ mutation NOT called, toast shown.
  - Drop by mkifokeris ⇒ mutation called.
  - Drop into any other column ⇒ unaffected.

## Changes / Revert
- **One atomic migration** `supabase/migrations/<ts>_unique_lead_stage.sql`: add `restricted_to_user_id`
  column; insert `unique_lead` stage with the restriction set; create restriction trigger; replace
  `leads_email_automations`. Includes a `-- ROLLBACK` block: drop trigger+fn, restore prior
  `leads_email_automations` body, drop column, delete the `unique_lead` row.
- Frontend changes in a separate commit.
- **Migration is NOT applied to prod until the user gives the go** (standing rule).

## Out of scope (YAGNI)
- A general per-stage permissions UI. The single `restricted_to_user_id` field covers this need; a
  full UI can come later if more locked columns appear.
- Backfilling welcome emails for leads already sitting in New Lead.
