# SEO Done → Renewal on next paid cycle

**Owner decision (2026-07-27):** for recurring SEO work, the technical teams park a card in **Done** when the month's work is finished. When the client pays the **next** month, the card must return to **Renewal** automatically. Done is a per-cycle resting column, not an end state — `closed` is the end state (used by `end_job` / `close_deal`, which also stop billing).

Trigger case: deal **000270** (AI SEO) — children `000270-AISEOLOC` / `-AISEOWEB` dragged to Done on 07-07 by the Local SEO team; client paid the 22/07–22/08 AI SEO month on 22/07; cards stayed in Done because `release_deal_jobs` branch 1c skips every terminal stage.

## Behavior

- Scope: `web_seo` / `local_seo` jobs (incl. AI SEO €0 children). **Ads/Social unchanged** (no cycle guard there; owner may extend later).
- A Done card is pulled to Renewal by the payment release **only when** the latest paid period started **after** the card entered Done (`period_start_date > done_at::date`). Same-cycle corrections (unpay/repay, amount edits) do **not** yank freshly-finished cards — preserves the 2026-07-06 anti-bounce fix.
- Legacy Done cards (`done_at IS NULL`, placed before this change) are pull-allowed on their deal's next Fully-Paid entry — deliberate, so 000270 self-heals.
- `closed` / `suspended` / `verification` stay fully sticky.

## Changes

- Migration `supabase/migrations/20260727120000_seo_done_to_renewal_on_paid_cycle.sql`:
  1. `jobs.done_at timestamptz` + `jobs_stamp_done_at` BEFORE UPDATE trigger (stage → `done` stamps `now()`; leaving `done` clears).
  2. `release_deal_jobs` branch 1c terminal-skip gains the Done exception above. Branches 1a/1b/2/3 byte-identical to `20260716190000` (drift-checked at authoring; **re-check live via `pg_get_functiondef` immediately before applying** per standing rule).
- No frontend changes.

## Verify (on prod, before + after apply)

Rolled-back DO-block harness (raise exception at end):
- RED (old fn): Done SEO job + advanced paid period → stays Done.
- GREEN (new fn): same → Renewal; freshly-Done (done_at ≥ period_start) → stays; `closed`/`suspended` → stays; ads Done → stays.
- Real-world: 000270 — next Fully-Paid entry (Eirini marking today's ads payment paid) must move both AISEO children Done → Renewal.

## Revert

- `git revert <migration commit>` for the repo file, and on prod:
  - restore `release_deal_jobs` from `20260716190000_one_time_seo_onboarding_parity.sql` (drift-check live def first);
  - `drop trigger if exists jobs_stamp_done_at on public.jobs; drop function if exists public.jobs_stamp_done_at(); alter table public.jobs drop column if exists done_at;`

## Status

- 2026-07-27: migration authored + committed. **NOT yet applied to prod** — needs SQL access (Supabase MCP / Mgmt API token).
