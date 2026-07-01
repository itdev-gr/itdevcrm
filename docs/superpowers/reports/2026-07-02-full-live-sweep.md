# Full Live Sweep — Site + DB + Email Triggers + Optimization (2026-07-02)

**Scope:** frontend build/tests, Supabase advisors + platform logs (first run since 06-28), DB integrity, full billing-harness re-runs (102 scenarios), static audit of all 9 email producers, one controlled live email end-to-end, Playwright sweep of ~25 routes as admin + sales manager, optimization distillation.
**Plan:** `docs/superpowers/plans/2026-07-02-full-live-sweep.md`. All DB checks savepoint-rolled-back except the one approved live email (to info@itdev.gr, throwaway lead deleted after).

---

## 1. Frontend

| Check | Result | Baseline | Verdict |
|---|---|---|---|
| `npm run build` (tsc -b + eslint + vite) | exit 0, only the known >500 kB chunk warning | same | ✅ |
| `vitest run` | **17 failed / 663 passed** (680 tests, 158 files) | all pass | 🔴 P2 — test drift, not runtime bugs (see F2) |
| `npm audit` prod deps | **0 vulnerabilities** | 24 (12 high) on 06-28 | ✅ huge improvement |
| `npm audit` incl. dev | 10 (4 moderate, 6 high) — dev tooling only | 24/12 | ✅ improved |

## 2. Advisors + platform logs (first successful run since 06-28)

- Security: **112 lints, 0 ERROR** (was ~292 with 49 ERRORs). Zero `rls_disabled_in_public`, zero anon-fn findings — the 07-01 grant remediation + default-privilege hardening is holding (also verified live: new-object probe clean, secdef-anon count 0).
- Remaining WARN: 59 `authenticated_security_definer_function_executable` (intended app RPCs, internally gated), leaked-password-protection off, `sales_stage_rank` mutable search_path (last of the original 15).
- INFO: 51 `rls_enabled_no_policy` — 49 backup tables (locked to nobody, fine) + `seo_onboarding_config`, `user_google_accounts` (accessed only via secdef fns → fine, verified).
- Performance: **unindexed FKs 39 → 0**, `auth_rls_initplan` 27 → 2 (only `data_integrity_alerts` ×2 left), `multiple_permissive_policies` flat at 26, 37 unused indexes flagged.
- Logs (24h): zero 5xx, zero timeouts. Two error classes traced: `permission denied for mentionable_users` + `invalid uuid "t1"` from a **node** UA = the vitest suite making real network calls to prod (see F3) — the 401 is the 07-01 hardening working correctly; browser calls are 200.

## 3. Database integrity

Crons 0 failures/3d (drain ~720/day; `reconcile_payment_integrity` first run pending — scheduled 07-01 for 04:00 UTC; `daily_move_overdue_deals_to_on_hold` deactivated 06-26 = intentional supersession by `reconcile_block_lifecycle`). Outbox: 0 stuck; failure profile unchanged vs baseline (55×422 invalid-to + 32×429, none since 06-27). Orphans: all 0. Duplicate period-keys: 0. Sentinels: all `paid_in_full`. Cancelled rows: 0 (pause feature not yet used). Stuck on-hold: 000039 + 000280 unchanged (known, accounting judgment). Zero-length windows: 51 rows — 50 are semantically-fine `one_time` single-day invoices; only the known 000387 recurring row is a genuine anomaly (prior report's "1" undercounted by not distinguishing billing types).

## 4. Billing harness re-runs (102 scenarios)

Full smoke 56/56 profile-identical to baseline (42 PASS + 11 S2-expected + 2 INFO + 1 pre-existing F3). Pause harness 8/8 PASS. Flip + edge-cases profile-identical (one category refinement: flip-E now S2-expected instead of HARNESS_BUG — confirms mitigation S1 landed). Reminders/SEO-reconciler/lead-distribution harnesses are pgTAP-designed (prod-incompatible as-is) but their underlying functions verified working via DO-block adaptations. **Zero regressions.** Zero residue.

## 5. Email triggers — verdict table

| Producer | Verdict |
|---|---|
| `leads_email_automations` (lead_welcome) | ✅ correct (stage gate, dept toggle, dual dedupe, opt-out) — no email-shape validation (F4) |
| `deals_enqueue_won_welcome` | ✅ correct (relies on send-email closed-client chokepoint — present) |
| `jobs_seo_onboarding_email` | ✅ correct incl. AI-SEO children; dedupe is per-deal not per-job (F8 footgun) |
| `enqueue_payment_reminders` | ✅ correct (−7/+1/+7, suppression, closed-client, per-payment dedupe); `payment_due_today` template orphaned (F9) |
| `process_email_sequences` | ✅ gated on dept_sales (by design, not global) |
| `email_notify_new_job` | 🔴 **DEAD** — see F1 |
| `email_notify_new_task` | ✅ fires (no toggle by design; self-assign skipped; deep-link correct) |
| drain path (pulse + cron + claim/recover) | ✅ service-role-only, secret compared timing-safe |
| send-email edge fn (v41 = repo, no drift) | ✅ routing/cleanSubject/escaping/chokepoint correct; single-send auth = known-open H2 (F6); outbox dedupe race = known-open L4 (F7) |
| resend-webhook / auth-email | ✅ signature verification intact |

**Live end-to-end (approved single send):** lead insert → outbox claimed 264ms → sent 641ms → **Resend delivered in 4.15s**; correct identity (sales), dedupe key, payload, rep CC. Pipeline fully healthy. Toggles: all 3 dept toggles ON, global OFF (per design), scheduled_* OFF (intentional). Templates: 22 rows, `{{code}}` + Greek greeting/sign-off conventions confirmed.

## 6. Live site (Playwright, ~25 routes, admin + sales manager)

**Zero console errors, zero failed API requests across every page and both roles.** Boards, detail pages, tabs, settings, tasks probe (create→resolve), pause-billing dialog — all clean. Role gating correct (nav trimmed, search results scoped, admin URLs denied). Quirks: `/tech/ai-seo` 404 (by design — split model, no board), no standalone offers list (offers live on deal tabs), Email Health correctly showing the known invalid-recipient failures.

## 7. Fixed during sweep

- 🔧 Deleted the 2 leftover `sweep-DELETE-ME` resolved tasks (probe artifacts; tasks UI has no delete — noted as F11).
- 🔧 T6 throwaway lead deleted via `delete_leads`; `email_log` audit row retained (resend id `7a09adfd-2b1e-415f-a423-981a36247432`).

## 8. Open bugs / action items (priority order)

1. 🔴 **F1 — `email_notify_new_job` silently disabled.** `email_automation_enabled('internal_new_job')` → unmapped department → falls back to `global` (false), AND no `internal_new_job` settings row (coalesce → false). Internal new-job emails have not sent since the dept-toggle migration (2026-06-24). Fix: map `internal_new_job` in `email_setting_department` + add an enabled settings row (or gate on a dedicated internal toggle).
2. 🟡 **F2 — 17 failing unit tests (3 files, fixture drift):** `LeadIntakePage.test.tsx` ×15 (needs `QueryClientProvider` wrapper since `useAutoRelease`), `EmailHealthBanner.test.tsx` ×1 (needs `MemoryRouter` since the banner links to Email Health), `serviceInfoFields.test.ts` ×1 (expected array missing the new `website` field).
3. 🟡 **F3 — unit tests hit production.** `AssignedTaskDetailDialog.test.tsx` renders `CommentForm` → real `supabase.rpc('mentionable_users')` with the anon key (vitest has no supabase mock; fixture ids like `t1` reach prod → uuid errors in pg logs). Pre-07-01 this silently READ the staff list from prod. Fix: mock `@/lib/supabase` in `vitest.setup.ts` (or strip env in vitest config).
4. 🟡 **F4 — lead email data quality (ongoing P2):** 55 invalid-to Resend 422/7d unchanged; live rows: 5 leads + 1 client invalid, 1 client with two comma-joined emails. Fix: shape-validate at `enqueue_lead_email` + intake/import; one-shot cleanup of the 7 rows.
5. 🟡 **F5 — akotzampasakis re-included in lead round-robin.** `exclude_from_lead_distribution=false` now (was paused 2026-06-22 per project memory); the sweep's test lead auto-assigned to him. Confirm deliberate; update memory or re-flag.
6. 🟡 **F6 — send-email single-send open to any authenticated user (H2, known-open).** Becomes critical when the client portal ships.
7. 🟢 **F7 — `email_outbox` lacks a unique dedupe index (L4 TOCTOU, known-open).** `email_log`'s sent-unique index catches the dupe at send-time; add outbox unique partial index to close the race. Also: `email_log_dedupe_sent` and `uniq_email_log_dedupe_sent` are identical — drop one.
8. 🟢 **F8 — SEO-onboarding dedupe is per-deal not per-job** (footgun for future multi-job-per-service deals) and the reconciler drops `name` from the payload (Greek greeting renders "Γεια σας ,").
9. 🟢 **F9 — `payment_due_today` template orphaned** (never enqueued) — wire an offset or delete the row.
10. 🟢 **F10 — access-denied job page leaks `document.title`** (client name + job code) and denied admin routes redirect silently (no toast).
11. 🟢 **F11 — tasks have no delete affordance** (resolved tasks accumulate; sweep artifacts had to be removed via SQL).
12. 🟢 Perf backlog (see §9), stuck deals 000039/000280 (accounting), 000387 zero-length recurring row (archaeology).

## 9. Optimization list (effort × impact)

| # | Item | Impact | Effort |
|---|---|---|---|
| 1 | Rewrite 2 remaining `auth_rls_initplan` policies (`data_integrity_alerts`) to `(select auth.uid())` | low-med | trivial |
| 2 | Consolidate `multiple_permissive_policies` on hot tables first: profiles (×6), jobs (×2), deal_payments, deal_payment_lines | med (every query) | medium |
| 3 | Verify + drop the 37 unused indexes (leads ×4, jobs ×3, deals ×3, contracts ×3 …) after a ≥1-week `pg_stat_user_indexes` confirmation | write-amp + storage | low |
| 4 | Code-split the 674 kB main chunk (offer builder, dashboard) | first-load UX | medium |
| 5 | Auth: enable leaked-password protection; switch pool from absolute(10) to percentage | hygiene | trivial (dashboard) |
| 6 | Drop the duplicate `email_log` dedupe index | trivial | trivial |
| 7 | Resend 429 spacing: NOT needed — no 429 since 06-27 | — | — |

Already healthy: `global_search` 8.7 ms live (pg_stat mean was polluted by pre-06-23-fix calls), zero seq-scan-dominant tables >5k rows, email pipeline 4 s end-to-end, FK indexes complete.

## 10. Verdict

**No regressions in core billing, data integrity, or the security boundary — and the site runs error-free in the browser for both roles.** The material catch of this sweep is **F1: internal new-job notification emails have been silently dead since 2026-06-24** — a real functional bug in exactly the area the sweep targeted. Everything else is test hygiene (F2/F3), known-open items now re-confirmed with precise evidence (F6/F7), small data-quality debt (F4), and a short, concrete optimization backlog (§9).
