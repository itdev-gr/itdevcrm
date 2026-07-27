# SEO Done → Renewal whenever a new cycle is paid

**Owner decision (2026-07-27):** for recurring SEO work, the technical teams park a card in **Done** when the month's work is finished. When the client pays the **next** month, the card must return to **Renewal** automatically. Done is a per-cycle resting column; `closed` is the end state (used by `end_job` / `close_deal`, which also stop billing).

Trigger case: deal **000270** (AI SEO) — children `000270-AISEOLOC` / `-AISEOWEB` dragged to Done 07-07; client paid the 22/07–22/08 AI SEO month on 22/07; cards stayed in Done.

## Root cause (live findings, 2026-07-27)

- `done` is **not** terminal on web_seo/local_seo/ads (only `closed` is) — `release_deal_jobs` branch 1c *already* pulled Done→Renewal.
- But its **only caller** is `deals_hold_jobs_on_stage_change`, i.e. it fires solely on an accounting-stage **transition** into Fully Paid. A deal that keeps paying on time never re-enters Fully Paid → its Done cards never return. Holds are never auto-lifted, so "client paid" often produces no transition at all (verified: marking 000270's ads payment paid left the deal `on_hold`).

## Change (migration `20260727120000_seo_done_to_renewal_on_paid_cycle.sql`)

1. `jobs.done_at` + `jobs_stamp_done_at` BEFORE UPDATE trigger (enter `done` → `now()`; leave → NULL). Legacy Done cards keep NULL = pull allowed.
2. `seo_pull_done_to_renewal(deal)` — narrow pull: web_seo/local_seo (incl. AI SEO children) in `done` → `renewal` when the paid period advanced past onboarding (+14d) **and** past the Done drag (`period_start_date > done_at::date`). Recomputes period dates first (parents before children) so trigger ordering can't feed it stale dates. No unblocks, no onboarding.
3. `deal_payments_pull_done_on_paid` — AFTER INSERT/UPDATE OF status: any payment landing on `paid` runs the pull for that deal. This is the owner's rule verbatim, independent of stage transitions.
4. `release_deal_jobs` 1c gains the same done-guard, so Fully-Paid *re-entries* (unpay/repay, hold trips) no longer yank freshly-parked cards. Body otherwise byte-identical to the live 2026-07-27 def (incl. the 07-17 `maintenance` additions — drift caught at apply time; always `pg_get_functiondef` first).

Scope: SEO boards only. Ads/social/maintenance renewal behavior unchanged.

## Verification (prod, 2026-07-27)

- RED (pre-change, rolled back): direct release call pulled Done cards — proving the gap was the *missing call*, not the pull.
- GREEN dress rehearsal (migration + matrix in one rolled-back txn, zero residue verified):
  `A` mark ads payment paid → both children `renewal` (deal stayed `on_hold`) · `B` freshly-Done stays · `C` done_at older than period → pulled · `D` `closed` sticky · `E` release re-entry respects fresh-done guard.
- Applied; `seo_pull_done_to_renewal('000270')` healed both children → `renewal` (done_at NULL legacy path).

## Revert

- `git revert <commit>`; on prod run the ROLLBACK block in the migration header (drop 2 triggers + 2 functions + column; restore `release_deal_jobs` pre-image = 20260716190000 body + `maintenance` in branches 2/3 — drift-check live def first).

## Status

- 2026-07-27: **applied to prod + verified**; 000270 healed.
