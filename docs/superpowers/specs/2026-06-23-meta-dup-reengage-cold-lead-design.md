# Re-engage a cold lead from a Meta intake duplicate — Design

Date: 2026-06-23
Status: Draft for approval
Area: Lead Intake (`/sales/lead-intake`)

## Problem

A prospect who went cold (their lead sits in `dead_end`, `not_interested`, `no_answer`, or `constant_na`) submits a Meta form again. Today that incoming Meta lead lands in `lead_intake` flagged as a duplicate, and the only paths are: **Merge** (appends to the cold lead's `intake_log`, and for `dead_end`/`not_interested` actually *discards* the intake row), or **Release** (creates a brand-new duplicate lead in Unique Lead). Neither **re-engages** the existing cold lead. The product owner wants the re-submission to revive the existing lead instead of creating a duplicate.

## Current behaviour (verified)

- Meta webhook `/api/meta-lead` inserts a row into `lead_intake` with `source='meta'` and `matches` (from `find_lead_duplicates`, which matches existing leads in *any* stage by email/phone, plus won `deal_client`s).
- `release_lead_intake(p_id, p_force)` re-checks dupes and **inserts a new lead** into the `unique_lead` stage (sets GUC `app.intake_release='on'` to bypass the restricted-stage trigger). `contact_info` → the new lead's `notes`.
- `merge_lead_intake(p_id, p_target_lead_id)` **appends** the new submission to the target lead's `intake_log` (`format_intake_merge_block`), never overwriting fields; if the target is in `dead_end`/`not_interested` it **discards** the intake row instead.
- `lead_intake_auto_merge` trigger (toggle, default off): for a single lead match it appends to `intake_log` (or discards if the target is `dead_end`/`not_interested`).
- `lead_dead_end_ids` RPC currently treats only **2** stages as dead-end (`dead_end`, `not_interested`); the UI tags those with ⚠.
- Entering `unique_lead` via an UPDATE fires `leads_email_automations` → the **welcome email**.
- Volume now: 1 pending Meta intake row, which does match a cold lead. Forward-looking, low-risk.

## Decisions (from brainstorming)

1. **Trigger = on Release.** Pressing **Release** on a Meta intake row whose match is an existing lead in a cold stage re-engages that lead instead of creating a new one.
2. **Update = append only.** Do not overwrite the cold lead's fields; append the new Meta submission to its `intake_log` (same block format as Merge).
3. **Welcome email = resend.** Moving the cold lead into Unique Lead fires the welcome email as normal — keep it (no suppression).
4. **Cold stages (this feature)** = `dead_end`, `not_interested`, `no_answer`, `constant_na` (all four). Scope = `source='meta'` intake rows whose match is an existing **lead** in one of these stages. Won `deal_client` matches are out of scope.

## Design

### A. New RPC `reengage_lead_intake(p_id uuid, p_target_lead_id uuid)`

Server-side, security definer, mirrors the safety of `release_lead_intake`:

1. Load the intake row `r` (must be `pending`).
2. Validate `p_target_lead_id` is one of `r.matches` of type `lead` **and** the target lead is non-archived, non-converted, and currently in a **cold stage** (the four). Otherwise raise a clear error (`not_a_cold_match`).
3. `set_config('app.intake_release','on', true)` then **UPDATE** the target lead:
   - `stage_id` → the `unique_lead` stage id,
   - `intake_log` ← append `format_intake_merge_block(r)` (append-only; no field overwrite),
   - `updated_at = now()`.
   The stage move into `unique_lead` fires the existing welcome-email automation. **Caveat:** that automation enqueues with idempotency key `lead_welcome:<lead_id>`, so a lead that already received a welcome on its first Unique-Lead entry would be **deduped** (not actually resent). Because the decision is **resend**, the RPC explicitly enqueues the welcome with a re-engage-specific key (e.g. `lead_welcome:<lead_id>:reengage:<intake_id>`) so it sends again. (The plan confirms the enqueue helper signature; if a natural resend is preferred over a guaranteed one, this is the single line to drop.)
4. Mark the intake row resolved: `status='released'`, `released_lead_id = p_target_lead_id`, `reviewed_by = auth.uid()`, `reviewed_at = now()`. (We reuse `released_lead_id` to record which lead was put live; no new column needed.)
5. Return `jsonb_build_object('ok', true, 'lead_id', p_target_lead_id)`.

A small helper `lead_cold_ids(p_ids uuid[])` (the 4-stage analogue of `lead_dead_end_ids`) returns which of the candidate lead ids are in a cold stage — used by the UI to decide the Release behaviour and by the RPC's validation. (Leave `lead_dead_end_ids` unchanged so the existing merge-warning behaviour is untouched.)

### B. Release behaviour on the intake page

In `LeadIntakePage`, when the admin presses **Release** on a row:

- Compute the row's **cold-lead matches** = lead-type matches whose id is in `lead_cold_ids(...)` (via a new `useColdLeads` hook, sibling of `useDeadEndLeads`).
- **If `source==='meta'` and there is ≥1 cold-lead match:** call `reengage_lead_intake(rowId, targetColdLeadId)` instead of `release_lead_intake`.
  - Exactly one cold-lead match → that's the target.
  - Multiple cold-lead matches → use the existing **merge picker** to let the admin choose which cold lead to re-engage.
  - Show a brief confirm ("Re-engage <name> — move to Unique Lead and append this submission?") so the action is explicit.
- **Otherwise:** unchanged — `release_lead_intake` (create a new Unique Lead, with the force/recheck flow as today).

The button can read "Re-engage & release" (or keep "Release" with a ↻ hint) when a cold-lead match is present, so the admin sees what will happen. ("Ready for release" = the row is actionable via this Release path rather than being discarded as a dead-end dup.)

### C. Keep these rows reachable (auto-merge guard)

So an auto-merge can't silently discard a re-engageable row before the admin sees it: extend `lead_intake_auto_merge` so that when `source='meta'` and the single match is a **cold-stage** lead, it leaves the row **pending** (no append, no discard) — i.e. routed to the manual re-engage-on-Release path. All other auto-merge behaviour is unchanged. (Auto-merge is off by default, but this guard makes the feature correct regardless of the toggle.)

## Components / files

- New migration `supabase/migrations/20260623xxxxxx_reengage_cold_lead_intake.sql`: `reengage_lead_intake` RPC, `lead_cold_ids` helper, and the `lead_intake_auto_merge` guard update. Includes rollback SQL (drop the new fns; restore the prior `lead_intake_auto_merge` body).
- Frontend:
  - `src/features/leads/hooks/useColdLeads.ts` (mirrors `useDeadEndLeads`).
  - `src/features/leads/hooks/useReengageLeadIntake.ts` (calls the RPC; invalidates intake + leads).
  - `src/features/leads/LeadIntakePage.tsx`: Release handler branches to re-engage for meta + cold-lead matches (single-target or picker), with a confirm; button label/affordance update.
  - Pure helper `coldLeadMatchesOf(matches, coldIds)` in `intakeMatches.ts` (unit-tested).
- i18n strings (en + el) for the re-engage button/confirm.

## Testing / verification

- **Unit:** `coldLeadMatchesOf` (filters lead matches to cold ids); the Release-decision logic (given source + cold matches → re-engage vs release; single vs picker).
- **RPC (manual, prod-like):** re-engage moves the target cold lead to `unique_lead`, appends to `intake_log` (no other field changed), marks the intake row released with `released_lead_id`, and creates **no new lead**; rejects a non-cold or non-matching target.
- **Live smoke:** the existing 1 pending Meta+cold row → Release re-engages the old lead to Unique Lead (welcome email enqueued), no duplicate created; a normal Meta row with no cold match still Releases a new lead.

## Non-goals

- No change to `release_lead_intake` for non-cold rows, to `merge_lead_intake`, or to `lead_dead_end_ids`/the existing ⚠ merge warning.
- No field-overwrite (append-only, as decided).
- Won `deal_client` (existing-customer) matches are not re-engaged here.
- Import-source rows keep current behaviour (feature is Meta-only).

## Changes / Revert

- **DB:** new functions only (`reengage_lead_intake`, `lead_cold_ids`) + a body change to `lead_intake_auto_merge`. Rollback SQL: drop the two new functions and `create or replace` the previous `lead_intake_auto_merge` body (included verbatim in the migration). No data backfill, no table/column changes.
- **Frontend:** revert the intake-page + hooks + i18n commit. The default release/merge/discard flows are untouched for non-meta / non-cold rows.
