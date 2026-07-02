# Full-Project Smoke Test — 2026-07-02

Maximal smoke of the whole production system (www.itdevcrm.com, Supabase `xujlrclyzxrvxszepquy`): every page, backend process, cron, and trigger. Read-only where possible; all mutations on smoke entities, cleaned up. Baseline = the 2026-07-02 full-live-sweep (F1–F12).

**Headline:** The system is healthy. Frontend renders every page with **zero console errors and zero failed network calls**; backend health, all crons, and edge/API endpoints are green; data-integrity is clean on the regression-prone classes (AI-SEO child amounts, VAT, dedupe, code uniqueness, orphan FKs on live data). **Two genuine bugs** found (1 mobile-nav P2, 1 stale-block-reason P3) plus a handful of WARN/watch items. No P0/P1.

---

## Findings to fix (new)

| ID | Sev | Area | Summary |
|----|-----|------|---------|
| **N1** | **P2** | Mobile UI | On narrow viewports the top-bar **search input overlaps the hamburger button and intercepts its clicks** → the nav drawer cannot be opened on mobile. |
| **N2** | **P2?** | Accounting billing | **8 deals moved to `on_hold` today (2026-07-02) that are not actually overdue** — each has an unpaid *future-dated* payment. Needs human confirm: possible over-eager hold from concurrent billing-mitigation work. |
| **N3** | **P3** | Job block lifecycle | Job `000063-LOCALSEO` is `is_blocked` with reason **`account_on_hold`** while its deal is in `partial_payment` — a stale reason left over when the deal exited On-Hold. |
| **N4** | **P3** | Lead data quality | 6 non-archived leads with malformed emails (baseline 5 — slight upward drift), all `source='import'`; 1 (`003401`) has a ` - ` double-email. Import path still lacks email-shape validation (this is the F4 class, lead-side). |
| **N5** | **P3** | Email pipeline | 32× Resend `429 rate_limit_exceeded` in 7d — drain/enqueue bursts exceed Resend's 10 req/s cap. Transient + retried, but a small drain throttle would remove the noise. |
| **N6** | **P3** | Data hygiene | 10 historical orphan rows (4 attachments + 6 comments) referencing hard-deleted leads/jobs from the 06-18/19 wipes; 5 closed/done recurring jobs still `billing_active=true` (no billing impact). Cleanup candidates. |

### N1 — Mobile nav is unusable (details)
`src/components/layout/Topbar.tsx`. Reproduced live at 375px: `document.elementFromPoint(hamburger centre)` returns `INPUT.search`. The centered search wrapper (`x:16→right past 74`) sits over the hamburger (`x:0→right:36`), so every click on the menu button lands on the search box. Fix: on `<md` breakpoints, either hide the search or reserve the left gutter for the hamburger (give the burger a higher stacking context / the search container a left margin past the button). This was the `mobile-nav.spec.ts` failure — the spec is correct; the app is wrong.

### N2 — Deals held without being overdue (details)
Deals `000078, 000115, 000221, 000227, 000397, 000402, 000408, 000418` are in `on_hold` but each has only an unpaid **future-dated** payment (owe soon, nothing overdue), and all were moved to On Hold **today**. `reconcile_deal_stage` should only route to `on_hold` when the earliest unpaid `start_date` is in the **past**. Either these were moved manually, or the reconcile/overdue logic (touched by today's billing work) is holding too eagerly. **Confirm whether intended** before treating as a regression.

### N3 — Stale block reason (details)
`deals_release_jobs_on_partial_payment` releases only web_dev/hosting; when a deal goes On-Hold → partial_payment, a pre-existing `account_on_hold` block on SEO jobs is neither cleared nor re-labelled to `partial_payment_pending`. The job *stays* blocked (correct for partial payment) but shows the wrong reason ("On Hold") until `paid_in_full` clears both reasons. Low impact; cosmetic/semantic.

---

## Known-findings ledger (F1–F12) — status this run

| ID | Status now |
|----|-----------|
| F1 internal new-job emails | **FIXED** — `internal_new_job` toggle ON, cron healthy, trigger present. |
| F2 17 failing unit tests | **FIXED** — vitest **695/695 green**. |
| F3 vitest hits prod | OPEN — still no supabase mock in `vitest.setup.ts`. |
| F4 lead email data quality | OPEN — see N4; lead-side trending slightly worse via imports; **client-side now clean** (was 1 bad + 1 comma → 0). |
| F5 akotzampasakis round-robin | **Confirmed correct** (user-confirmed 07-02); not a finding. |
| F6 send-email single-send open to any auth user | OPEN (pre-portal). |
| F7 email_outbox missing dedupe index + duplicate email_log index | OPEN. |
| F8 SEO onboarding | blank-greeting half **FIXED** (reconciler passes name — verified today); per-deal dedupe = by design. |
| F9 payment_due_today template orphaned | OPEN. |
| F10 denied route silent redirect + title leak | OPEN — **confirmed** silent redirect (sales rep → `/admin/users` → home, no toast). |
| F11 tasks have no delete affordance | OPEN. |
| F12 backlog (stuck deals, perf) | 000039/000280 still held (expected); sentinel **000066 now `on_hold`** for a *legit* new overdue period (not a regression). |

---

## Phase results

### P0 — Baseline
- Git in sync (0 unpushed/behind); `npm run build` clean; **vitest 695/695**.
- **pgTAP SKIPPED** — no Docker/OrbStack on this machine.
- Prod deploy fresh (live bundle contains today's `cash_charge_vat` feature).
- **Trigger drift clean** — the two dropped event-movers (`deal_payments_move_to_awaiting`, `..._release_from_on_hold`) are absent; `deal_payments_reconcile_stage` present (correct single-mover); `20260623150000` landmine trigger not live.
- Toggle/distribution snapshot captured & restored (verified identical post-run).
- Sentry pull SKIPPED (no API token) — covered by live console/network capture.

### P1 — Backend health (read-only) — PASS
`email_pipeline_health` ok; 0 stuck/sending emails; **all 11 crons active + last runs succeeded**, `daily_move_overdue_deals_to_on_hold` correctly inactive; **0 recurring-payment gaps on live deals** (5 apparent gaps all on closed/done deals); edge/API endpoints all correct (healthz 200; meta-lead/pbx bad-key → 401; unsubscribe bad-token → graceful 400; send-email reachable, no 5xx). WARNs → N4/N5.

### P2 — Data-integrity sweep (30 read-only probes) — mostly PASS
0 orphan FKs on live data; **0 AI-SEO children with money** (regression class clean); 0 email dedupe dupes; 0 code collisions; **0 VAT anomalies** (today's cash-VAT feature holds — no cash+no-charge job seeded with 24%); 0 stuck intake; 0 expired-active announcements; 0 future task periods; 0 user orphans. FAIL/WARN → N2, N3, N4, N6.

### P3 — UI walkthrough — PASS (1 bug)
- **Playwright suite vs prod: 22 passed / 4 failed / 3 skipped.** All 4 failures triaged: **dashboard** (renders fully with real data — selector drift), **local-seo Blocked column** (renders; `🔒` emoji removed from label — spec stale), **jobs-billing add-job** (jobs render as **cards**, spec expects a table `cell`; also a mutating spec), **mobile-nav** = the **real N1 bug**.
- **Live browser sweep** (login + 9 pages incl. dashboard, sales kanban/leads, accounting onboarding/report, web-seo board, email-health, a deal detail + Jobs tab): every page renders, **0 console errors** (only benign login-page auth-refresh noise), **0 failed network requests** (all 200).

### P4 — E2E business flows — COVERED INDIRECTLY (not run as a fresh live mutating flow)
A full smoke-entity lifecycle (intake→convert→accounting stages→job spawn→emails→cleanup) was **not executed as a new live mutating run** this session (scoped to protect prod + session length). Its correctness was instead verified through: the P2 integrity probes (which inspect the *outputs* of every lifecycle trigger on real data — stage consistency, block reasons, dedupe, VAT, AI-SEO amounts), earlier same-day prod functional probes (cash-VAT seed → 0/24, reconciler passes name), and the Playwright create-flows (create-client, add-job, create-task all **passed**). **Recommendation:** run a dedicated live E2E session for the mutating lifecycle if you want button-by-button confirmation.

### P5 — Role gating — PASS
Sales rep (`akotzampasakis`): sidebar shows only Home/Tasks/SALES (no Dashboard/Settings/Accounting/Technical/Lead-Intake); direct URL to `/admin/users` **redirects to home**. Route guards + sidebar gating work. (Redirect is silent — F10.)

---

## Test-harness notes (not app bugs, but worth fixing)
- Playwright **chromium binary wasn't installed** — first run reported 28 false failures (`chrome-headless-shell` missing) until `npx playwright install chromium`.
- 3 specs need selector updates (drift, not app bugs): `dashboard-smoke` (tile labels), `local-seo-board` (`/🔒 Blocked/` → `/Blocked/`), `jobs-billing-smoke` (`getByRole('cell')` → the card layout).
- `jobs-billing-smoke` cleanup archives the client+deal but **not the job** it creates via `create_custom_job` — left 2 live jobs (`005570/005571-WEBDEV`) which this run archived.
- No supabase mock for vitest (F3) — unit tests hit prod anon API.

## Cleanup verification
- E2E clients (3) + deals: all archived by the specs' `afterAll`. 2 residual E2E jobs archived by this run → **0 live E2E rows remain**.
- Email-automation toggles + lead-distribution flags: **identical to the pre-run snapshot** (browsing touched nothing).
- No smoke entities created by this session beyond the Playwright specs' own (self-cleaned).

## Not covered / skipped (by design or environment)
pgTAP (no Docker), Sentry digest (no token), live mutating E2E lifecycle (see P4), password-change / Google-OAuth / user-deactivate / live-stage-archive (destructive), a per-page click of every admin mutation (spot-checked, not exhaustive).
