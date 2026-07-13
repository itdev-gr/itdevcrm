# Local SEO jobs reverting to "New project" — root cause & fix

## Report
Accounting sets a deal's client status to *done* and moves the accounting stage to
*Done*; an open Local SEO job flips back to **New project**.

## Investigation (2026-07-13, read-only + contained demo reproduction)
- **The Done move is not the cause.** Verified in code: the accounting stage-change
  trigger (`deals_hold_jobs_on_stage_change`) only *unblocks* jobs on `done`;
  `reconcile_deal_stage` no-ops at `done`. Reproduced the exact workflow on a demo
  deal (onboarded local_seo job at `optimize` → Paid In Full → re-entry → client
  `done` → move to Done): the job **stayed at `optimize`**, no reset, no email.
- **Behavioural matrix** (demo jobs, firing Paid In Full):

  | Job state | Result |
  |---|---|
  | onboarded, on-board (`optimize`) | stays `optimize` |
  | not onboarded, on-board (`optimize`) | stays `optimize` |
  | not onboarded, off-board (`stage_id` NULL) | → `new_project` (correct first onboarding) |
  | onboarded, off-board (`stage_id` NULL) | placed → `new_project` by the 15-min `reconcile_offboard_jobs` cron |

- **Root cause:** a job reaches `new_project` only when its `stage_id` is NULL at
  placement time. The real defect is upstream — a path that **nulls an already-
  onboarded job's stage** (one-off operator bulk ops; the AI-SEO re-derivation for
  children; observed SYSTEM batch 2026-07-06 13:44:52 that reset 004816/000045/005548
  `renewal→new_project` and re-fired 3 onboarding emails). Once off-board, standing
  placement + `jobs_seo_onboarding_email` bounce it to `new_project` and re-email.

## Fix (shipped as migration `20260713200000_protect_onboarded_seo_stage.sql`)
A row-level **absolute invariant** (BEFORE UPDATE OF stage_id on `jobs`), scoped to
standalone SEO jobs (`local_seo`/`web_seo`, `parent_job_id` NULL, not billing-only)
that have already onboarded:
- **(a)** never take an on-board job off-board via a write → keep the old stage;
- **(b)** never (re)place at `new_project` → redirect to `renewal` (no onboarding
  email, no reset to the entry column).

No actor check (a SECURITY DEFINER release runs under the caller's `auth.uid()`, so an
actor gate can't separate a board drag from an automatic placement). First onboarding
is unaffected: at that point `onboarded_at` is still NULL, so the guard skips.

Deliberately does **not** rewrite `release_*` / `reconcile_offboard_jobs` (prod bodies
are known to drift from the repo; must be read live via `pg_get_functiondef` first).

## Changes / Revert
- Add: `public.jobs_protect_onboarded_seo_stage()` + trigger `jobs_protect_onboarded_seo_stage`.
- Revert: `drop trigger … ; drop function …` (in the migration footer).
- No data backfill here; mis-reset historical jobs are restored separately from the
  activity log where the team hasn't already fixed them.

## Open / follow-up
1. **Confirm no drift** in the live `release_deal_jobs` / `release_jobs_for_deal`
   bodies (needs SQL access / `pg_get_functiondef`).
2. Optional: audit the AI-SEO re-derivation so it never nulls a *standalone* SEO job.
3. Monitor: flag any onboarded→`new_project` attempt (the guard's `raise warning`
   surfaces it; a scheduled check can aggregate).
