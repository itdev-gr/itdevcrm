# Done = monthly rest, Closed = ended — job lifecycle refinement

**Date:** 2026-06-26
**Status:** Draft for review (no implementation yet)
**Builds on:** `2026-06-26-payment-driven-block-lifecycle-design.md`

## Problem

"Done" on the technical boards is currently **terminal**, but the user uses it to mean
*"work for this month is finished, waiting for the client to renew."* Blocking must never
shuffle a job's board position (it's a virtual overlay), while **payment** should restart the
cycle by sending the work to Renewal, and **closing** should send everything to Closed.

## Goal

Model the recurring cycle **Active → Done (rest) → [client pays] → Renewal → Active …**, with
a clean terminal **Closed** when the engagement ends.

## Decisions (confirmed)

| # | Decision |
|---|---|
| 1 | "Done" lane (non-terminal) on **web_seo, local_seo, ads, social_media**. Hosting + Web Dev keep their current flow (no Done). |
| 2 | When a deal goes On-Hold, **Done jobs are NOT blocked** (work's finished for the cycle). |
| 3 | **Every time a deal is Paid, ALL its renewable jobs move to Renewal** (web_seo, local_seo, ads, social_media) — regardless of their current stage (active, done, or blocked). |
| 4 | When a deal is **Closed**, **all its jobs auto-move to their board's Closed (terminal) lane**. |
| 5 | **Blocking never changes a job's position** — it's a virtual "Blocked" column (`stage_id` untouched). The only stage moves are the two intentional ones: **Paid → Renewal** and **Closed → Closed**. |
| 6 | For **closed deals, never create new jobs** — only move existing ones. |

## Design

### A. The "Done" lane (non-terminal)

- **web_seo, local_seo:** flip the existing `done` stage to `is_terminal = false`.
- **ads, social_media:** add a new `done` stage (non-terminal), positioned right after
  `active` (pos 35), labelled "Done" / "Ολοκληρώθηκε".
- Meaning everywhere: *cycle finished, waiting for renewal.*

### B. Blocking is a virtual overlay (never moves a job)

- Block = `is_blocked` flag only; `stage_id` is **never changed**. The job appears in the
  board's virtual "Blocked" column while blocked and returns to its exact stage when unblocked.
- `block_deal_jobs` blocks the deal's open jobs **except** web_dev, hosting, terminal-stage
  jobs, **and `done`-stage jobs** (Done = finished for the cycle; nothing to pause).
- The nightly reconciler clears any leftover `account_on_hold` block on a terminal **or
  `done`** job.

### C. Paid → all renewable jobs go to Renewal

When a deal enters `paid_in_full` (on payment, from any stage):
- **Move every one of the deal's renewable jobs → their board's `renewal` stage** —
  `web_seo, local_seo, ads, social_media` — whatever stage they were in (active, done, or
  blocked). Clear any `account_on_hold` block at the same time.
- web_dev, hosting, and the ai_seo billing parent are **not** moved (no renewal lane / no
  work stage); they're just unblocked if needed.
- Fires immediately on payment **and** via the nightly reconciler as a safety net.
- *(This revises the earlier `release_deal_jobs`, which only moved the **blocked** jobs.)*

### D. Deal Closed → all jobs to the board's Closed lane

- A trigger on `deals`: when `accounting_stage_id` changes to the `closed` code, move **every
  non-archived, non-already-terminal job** of that deal → its board's `closed` (terminal)
  stage, set `status='completed'`, `completed_at`, and clear any block. Path-independent
  (covers the close dialog, manual moves, RPC).
- **Never create jobs.** Services with no job stay with no job; only existing jobs move.
- The `close_deal` RPC is simplified to just set the deal to Closed (the trigger handles the
  jobs); the close dialog drops per-job lane-picking.

### E. One-time cleanup

1. Flip web_seo + local_seo `done` to non-terminal; add `done` to ads + social.
2. Unblock any job currently blocked while in a `done` stage.
3. Revise `release_deal_jobs` to **move all renewable jobs → Renewal** + clear blocks.
4. **Verify every Closed deal's jobs are in their board's `closed` lane**; move any that
   aren't (existing jobs only — never create). Report the result.

## Scope / exclusions

- Hosting + Web Dev: no Done lane (Web Dev is one-time; Hosting uses Active).
- No new jobs are ever created by this work.
- Blocking never moves a job; the only stage moves are Paid→Renewal and Closed→Closed.

## Testing

- **Stages:** `done` is non-terminal on the 4 boards; ads/social have a Done column.
- **Block:** a Done job on an On-Hold deal is never blocked; a blocked active job keeps its
  `stage_id` through block→unblock (rolled-back test asserting position preserved).
- **Pay:** all of a deal's renewable jobs land in Renewal, regardless of prior stage; blocks
  cleared (rolled-back test).
- **Close:** all of a deal's jobs land in their board's Closed; no job created (rolled-back).
- **Final audit:** every Closed deal's jobs are in Closed.

## Changes / Revert

| Change | Revert |
| --- | --- |
| `done` → non-terminal (web/local SEO) + new `done` on ads/social | restore is_terminal=true; delete the ads/social `done` stages |
| `block_deal_jobs` excludes `done`; reconciler clears done/terminal blocks | restore prior bodies |
| `release_deal_jobs` = move all renewable jobs → Renewal + clear blocks | restore prior body |
| new `deals_close_jobs_on_close` trigger + simplified `close_deal`/dialog | drop trigger; restore `close_deal` + dialog |
| one-time cleanups | backups + revert SQL in the migration |

No payment dates are ever modified. No jobs are ever created.
