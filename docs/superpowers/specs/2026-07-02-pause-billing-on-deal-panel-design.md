# Pause/Resume Billing on the Deal Billing Panel — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — pending implementation plan

## Goal

Surface the existing **job billing pause/resume** control where accounting actually works — the **Deal detail page's billing panel** (`JobsBillingPanel`) — instead of only on the individual Job detail page. Frontend-only; the RPCs, permissions, and behavior already exist.

## Background (current state)

- Pausing a recurring service is done today via `JobBillingPauseCard` on `JobDetailPage` only. It calls `job_pause_billing` / `job_resume_billing` (hooks `useJobPauseBilling` / `useJobResumeBilling` in `src/features/jobs/hooks/useJobBillingPause.ts`), gated by `canEditBilling = isAdmin || group 'accounting'`. Pausing cancels the service's unpaid periods (kept in history); the job carries `blocked_reason='billing_paused'` while paused.
- Accounting works on the **Deal detail page**, where `JobsBillingPanel` (`src/features/deals/JobsBillingPanel.tsx`, rendered from `DealDetailPage.tsx`) already lists each job with title · department · price · status · group · an **End** button (`useEndJob` + `ConfirmDialog`).
- That panel does **not** expose pause/resume, so accounting can't reach it from their workflow.
- The single-owner accounting rule (`reconcile_deal_stage`) already excuses `cancelled` charges and never clears `billing_paused` blocks, so pausing composes correctly with the recent stage change.

## Design

Add a **pause/resume control per eligible job row** in `JobsBillingPanel`'s `JobRow`, reusing the existing hooks + i18n text (same pattern as the row's "End" button). No new backend, no new permissions, no duplicated pause logic.

**Eligibility (same as the job-page card):** the job is recurring (`billing_type in ('recurring_monthly','recurring_yearly')`) AND a parent (`parent_job_id == null`) AND not ended (`status !== 'ended' && billing_active !== false`) OR is currently paused. Controls render only when `!readOnly`.

**UX:**
- **Active + eligible** → a **"Pause billing"** button in the row's actions cell (beside "End"), opening a `ConfirmDialog` with the existing pause copy (unpaid periods cancelled, kept in history, never back-billed).
- **Paused** (`blocked_reason === 'billing_paused'`) → a **"Paused"** badge in the Status column + a **"Resume billing"** button (with its own confirm), reusing the resume hook.

**Data change (one field):** `useJobsBilling` currently selects `... parent_job_id` but not `blocked_reason`. Add `blocked_reason` to that `.select(...)` string, to the `JobBillingRow` type, and to the row mapping.

**Reuse:** `JobRow` imports `useJobPauseBilling` / `useJobResumeBilling` and renders `ConfirmDialog`s inline (exactly how it already uses `useEndJob`). i18n: reuse the existing pause/resume keys from the job namespace, or add matching keys under the `deals`/`jobs_billing` namespace if the existing keys aren't reachable — reuse the same Greek/English strings the card uses.

**Unchanged:** `JobBillingPauseCard` on `JobDetailPage` stays; this is an additional in-context entry point. The `job_pause_billing` / `job_resume_billing` RPCs and `canEditBilling` gating are untouched.

## Components & files

- **Modify** `src/features/deals/hooks/useJobsBilling.ts` — add `blocked_reason` to the select, the `JobBillingRow` type, and the mapping.
- **Modify** `src/features/deals/JobsBillingPanel.tsx` — in `JobRow`: pause/resume buttons + confirm dialogs + a "Paused" status badge, gated by eligibility + `!readOnly`.
- **Reuse (no change)** `src/features/jobs/hooks/useJobBillingPause.ts`, the `job_pause_billing`/`job_resume_billing` RPCs, `ConfirmDialog`.
- **i18n** `src/i18n/locales/{el,en}/deals.json` (and/or reuse existing `jobs_billing.*` keys) — pause/resume labels + confirm copy, matching the existing card's wording.

## Testing

- **RTL component test** (`JobsBillingPanel.test.tsx`, extend existing): (a) a recurring parent active job renders a "Pause billing" button; (b) a job with `blocked_reason='billing_paused'` renders a "Paused" badge + "Resume billing"; (c) a one-time or child (`parent_job_id` set) or ended job renders **no** pause control; (d) `readOnly` hides all pause/resume controls. Mock the pause/resume hooks; assert they're called on confirm.
- **Build gate:** `npm run build` (strict: tsc -b + eslint --max-warnings=0) green.
- **Browser smoke:** open a deal with a recurring parent job → Pause → row shows "Paused" + Resume; Resume → back to active. (Use a test/synthetic deal; pausing cancels real periods, so do it on a safe target and resume it.)

## Changes / Revert

- Frontend-only diff across the two files + i18n + test. Revert = git revert the commit(s). No migration, no data change.
- Push to `main`, atomic commits.

## Out of scope

- Any change to the pause **behavior**, RPCs, or permissions.
- The accounting kanban board card (this targets the deal billing panel; a board-card entry point can be a later, separate ask).
- Removing the job-page `JobBillingPauseCard`.

## Open questions

None — placement (deal billing panel row), reuse (existing hooks + confirm), and the single data addition (`blocked_reason`) confirmed with the product owner 2026-07-02.
