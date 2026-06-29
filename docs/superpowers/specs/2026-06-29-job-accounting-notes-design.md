# Job — Notes from accounting

**Date:** 2026-06-29
**Status:** Approved (design)

## Problem

When accounting creates a new job (via "Add custom job" on the deal billing
panel), they often need to leave a hand-off note for the service team: pricing
context, special instructions, what was agreed with the client, links to past
work, etc.

The form already has a "Description" field that writes to `jobs.description`,
but the value is never shown anywhere on the job. So whatever accounting types
is effectively lost — the service team opens the job and sees nothing.

We want accounting's note to be visible (and editable) on the job itself, and
also previewed on the deal's Overview so accounting can scan across jobs
without opening each one.

## Scope

In scope:
- Rename + reshape the existing "Description" input in `AddCustomJobForm` so
  accounting writes a multi-line note at job creation.
- Render the note prominently on the job detail page Overview, with inline
  edit.
- Show a single-line, read-only preview of the note on each job row of the
  deal's `JobsBillingPanel`.
- AI SEO children (`parent_job_id NOT NULL`) display the parent's note in
  addition to their own.
- Hide the note from client-portal users.

Out of scope:
- New DB column (we reuse `jobs.description`).
- Rich text / markdown.
- File attachments tied to the note (we already have per-service attachments,
  see [Service attachments](memory project_service_attachments)).
- Surfacing notes in lead/deal pages outside the billing panel.
- Backfilling or cleaning existing `jobs.description` data.

## Design

### Data model

No migration. The storage column is the existing `jobs.description text`.
RLS, FK, and types are unchanged. Empty input is normalized to `NULL` at the
client edge before the RPC call: `description.trim() === '' ? null : description.trim()`
in both `AddCustomJobForm` (create path) and the new job-page editor
(update path). The RPC itself is unchanged.

### Create flow

In `src/features/deals/AddCustomJobForm.tsx`:

- Replace the single-line `<Input id="cj-desc">` with a `<Textarea>` of
  ~3 rows (auto-grow).
- Re-label EN: "Notes from accounting" / GR: "Σημειώσεις λογιστηρίου".
- Move the field higher in the form (under Title, above the
  department/cadence row) so it's seen at creation time, not buried at the
  bottom.
- Translation keys: add `jobs_billing.form.notes_label` and
  `jobs_billing.form.notes_placeholder` under `deals` namespace; keep the old
  `jobs_billing.form.description` key as an alias for any external caller
  (unlikely but cheap).

The submit path is unchanged: the value flows through
`useCreateCustomJob → createCustomJob → p_description` → `jobs.description`.

### Job detail page

In `src/features/jobs/JobDetailPage.tsx`, add a new section at the top of the
Overview tab, above the existing service Info panel:

- Card titled **"Notes from accounting"** (GR: **"Σημειώσεις
  λογιστηρίου"**).
- Always rendered for staff users. Empty state shows muted text
  "No notes yet" + an "Add note" button.
- Click → inline `<Textarea>` with **Save** / **Cancel** buttons. Save calls
  the existing `useUpdateJobBilling` hook with `{ description: <value> }`.
  Cancel restores the prior value.
- Display mode renders with `whitespace-pre-wrap` so newlines survive, and
  passes through the existing URL linkifier (already used by email templates
  and the lead-info block — extract or import the helper).
- Permission to edit: anyone who can see the job. The card is hidden for
  client-portal users (`useIsClient()` or equivalent role check).

#### AI SEO children

When `job.parent_job_id` is not null, the card additionally fetches the parent
row's `description` and renders it as a smaller, read-only subsection above
the child's own editor, labeled "Notes from AI SEO parent". This keeps both
the local-SEO and web-SEO teams in sync with whatever accounting wrote on the
ai_seo billing parent — they cannot see the parent job directly because RLS
withholds `ai_seo` rows from their groups. See memory:
[AI SEO 3-row split](memory project_local_seo_owner).

Service-team RLS withholds `ai_seo` rows from local/web groups, so a plain
client `SELECT` on the parent will return zero rows. The implementation adds
a small security-definer RPC `get_parent_job_notes(p_child_job_id uuid)
returns text` that:

- Looks up the child's `parent_job_id`.
- Returns the parent's `description`.
- Returns `NULL` if the child has no parent or the caller cannot see the
  child itself (re-check the child's RLS inside the function so we don't
  leak parents).

Migration: `supabase/migrations/2026-06-29-get-parent-job-notes.sql` with a
paired `DROP FUNCTION` in the file's rollback section.

### Deal Overview preview

In `src/features/deals/JobsBillingPanel.tsx`, under each job row add a
single-line, muted preview:

- Class: `text-xs text-muted-foreground truncate`.
- Cap at 120 characters (`String.prototype.slice` + ellipsis).
- Hidden entirely when `description` is null/empty (no "No notes yet" here).
- Full text in a `title` attribute (native tooltip) for hover, and clicking
  the row already navigates to the job detail page.
- Read-only here. Editing lives on the job page (single source of truth, no
  duplicate editors fighting over the same value).

### Error handling

- The job-page editor reuses `useUpdateJobBilling`, which already routes
  failures through `throwOnFailure` and `captureMutation`. No new error paths.
- Empty save clears the field. No confirmation dialog — undo is just typing
  it back.
- Last-write-wins on concurrent edits (matches every other inline field on
  the job today).

### Testing (TDD per [Track changes for revert](memory feedback_track_changes_for_revert))

1. **AddCustomJobForm** — textarea renders with the new label key; multi-line
   value reaches `useCreateCustomJob` with the description preserved including
   newlines. Extends `src/features/deals/AddCustomJobForm.test.tsx`.
2. **JobDetailPage — empty state** — when `job.description` is null, the
   notes card shows "No notes yet" + the "Add note" button.
3. **JobDetailPage — edit save** — opening the editor, typing, and clicking
   Save calls `useUpdateJobBilling` once with the new value; UI then shows
   the value.
4. **JobDetailPage — AI SEO child** — when `job.parent_job_id` is set, the
   parent note renders as a read-only subsection labeled correctly, and the
   child note remains independently editable.
5. **JobDetailPage — client portal** — render with `isClient=true`
   → notes card is not in the DOM.
6. **Linkify** — a value containing `https://example.com` renders an
   anchor pointing at that URL (one integration assertion is enough; the
   linkify util has its own unit tests).
7. **JobsBillingPanel** — extends `JobsBillingPanel.test.tsx`: row with a
   note shows the muted preview truncated at 120 chars; row without a note
   has no preview node.

No backend tests (no RPC or schema change).

## Changes / Revert

### Files touched
- `src/features/deals/AddCustomJobForm.tsx` — input → textarea, relabel,
  reorder.
- `src/features/jobs/JobDetailPage.tsx` — add notes card with inline editor
  and parent-note subsection.
- `src/features/deals/JobsBillingPanel.tsx` — add per-row note preview.
- `src/i18n/locales/{en,el}/deals.json` — new label/placeholder keys, keep
  old `description` key.
- One security-definer RPC `get_parent_job_notes(uuid) returns text` (see
  AI SEO children section above). Migration
  `supabase/migrations/2026-06-29-get-parent-job-notes.sql` with paired
  `DROP FUNCTION` in the rollback section (per
  [Track changes for revert](memory feedback_track_changes_for_revert)).
- Tests added/extended as listed above.

### Revert
- All UI changes are pure code reverts — `git revert` the implementation
  commit(s).
- If the conditional RPC was added, the migration file contains its DROP
  statement in the rollback section. No data is touched.
- `jobs.description` data created during the feature remains in the column
  after revert; it just becomes invisible again (no destructive cleanup
  required).

## Open questions

None at this point — design is approved through Section 5.
