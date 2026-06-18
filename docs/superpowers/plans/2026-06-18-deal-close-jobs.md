# Deal-Close → Close Jobs Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.

**Goal:** When a deal moves to accounting "Closed", confirm via a dialog (per-job), mark the chosen jobs done, and move each to its board's close lane — and clean up the 228 deals already in Closed.

**Decisions (approved):** per-job controls in the dialog; web_dev jobs pick Closed-vs-Live; add a "Closed" terminal column to web_dev/social_media/ads/hosting (web_seo/local_seo already have "Done"); backfill existing closed deals' web_dev jobs → Closed.

**Close-destination per board:** web_seo→`done`, local_seo→`done`, web_dev→`closed`|`live` (per-job choice, default `closed`), social_media/ads/hosting→`closed`.

---

### Task 1 — DB: new "Closed" stages + `close_deal` RPC + backfill (immediate prod fix)

**Files:** `supabase/migrations/20260618000006_deal_close_jobs.sql`, `supabase/migrations/20260618000007_close_existing_closed_deal_jobs.sql`

- Migration 6: insert `closed` terminal stages on web_dev(120)/social_media(60)/ads(60)/hosting(50) `on conflict (board,code) do nothing`; create `close_deal(p_deal_id, p_jobs jsonb)` SECURITY DEFINER (perm gate = admin or `accounting_onboarding/complete_accounting`) that, per `{job_id,target_stage_id}`, sets job `status='completed'`, `completed_at`, `stage_id=target` (only if target is a terminal stage on the job's own board), clears blocks, then sets the deal's `accounting_stage_id` to `closed`.
- Migration 7 (one-time backfill): for non-archived jobs of accounting-`closed` deals currently in a **non-terminal** stage → `status='completed'`, move to `done` (web_seo/local_seo) or `closed` (others incl. web_dev), clear blocks.
- Apply both via Management API; record in `schema_migrations`; verify counts (closed-deal active jobs → 0 after).

### Task 2 — `CloseDealDialog` (+ test)

**Files:** `src/features/accounting/CloseDealDialog.tsx`, `.test.tsx`; helper `closeTargets.ts` (+ test)

- Pure helper `closeTargetCode(board, webDevChoice)` → `'done'|'closed'|'live'`; unit-tested.
- Dialog: `useJobsForDeal(dealId)` (jobs carry `stage{board,code}`) + `usePipelineStages`. Lists each job: service/title, current status+stage, a **close/keep** checkbox (default on), and for `web_dev` jobs a **Closed/Live** radio (default Closed). Computes `target_stage_id` per checked job via the board's close lane. Confirm → `close_deal` RPC with the checked jobs → invalidate accountingDeals/jobs. Cancel → no-op.

### Task 3 — Wire into the accounting board

**Files:** `src/features/accounting/AccountingOnboardingKanbanPage.tsx`, `src/lib/rpc.ts`

- Add `closeDeal()` wrapper in `rpc.ts`.
- In `onDragEnd`: if `stageId === closedStage.id` → open `CloseDealDialog` for that deal (don't call `moveStage`). Dialog handles the move on confirm.

### Task 4 — i18n + verify + commit

- `accounting.json` (en/el): dialog strings. Run tsc -b + lint + vitest + build. Commit per task.

## Changes / Revert
- Migration 6 rollback drops `close_deal` + the 4 `closed` stages. Migration 7 is irreversible data (original stages not retained). Code via `git revert`.
