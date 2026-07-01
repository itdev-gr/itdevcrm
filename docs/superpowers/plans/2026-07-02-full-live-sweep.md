# Full Live Sweep — Site + DB + Email Triggers + Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **All DB access via Supabase MCP tools only** (project `CRM`, id `xujlrclyzxrvxszepquy`); Bash/psql/curl for DB is hard-blocked. This is an AUDIT: read-mostly, findings-first. The ONLY prod mutations allowed are (a) savepoint-rolled-back DO blocks, (b) the single controlled email test in Task 6 (internal address only), (c) trivial data-level cleanups explicitly listed in Task 9 with backups.

**Goal:** Exercise the whole system — live site, database, billing state machine, and every email trigger — and produce one prioritized bug + optimization report, closing the 4 checks the 2026-07-02 sweep could not run (build/vitest/advisors/logs).

**Architecture:** Nine verification tasks, each dispatchable to a fresh subagent: local certification (build+tests), advisors+logs, DB integrity, billing harness re-runs, email-trigger static audit, one controlled live email end-to-end, a full Playwright site sweep with two roles, an optimization distillation, and a consolidated report. Findings are recorded, not fixed (except listed trivial data cleanups); code/DDL fixes become follow-up plans.

**Tech Stack:** npm/vitest local; Supabase MCP (`execute_sql`, `get_advisors`, `get_logs`); Playwright MCP on https://www.itdevcrm.com; git push direct to main at the end.

**Baselines to compare against (read them before their tasks):**
- `docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md` — prior sweep verdicts + §4 unverified list + open P2s (lead email data quality 55 invalid-to/7d; stuck deals 000039/000280; Resend 429s).
- `docs/superpowers/reports/2026-07-02-billing-mitigations-report.md` — harness baseline (full-smoke 79/104 PASS profile) + dry-run magnitudes (≈3 created / ≈1 moved).
- 06-28 audit (`docs/superpowers/plans/2026-06-28-codebase-audit-remediation.md`) — advisor baseline (292 lints pre-remediation), Phase-4 perf backlog, open H2/M-items.

**Deliverable:** `docs/superpowers/reports/2026-07-02-full-live-sweep.md` (Task 9 writes it; Tasks 1–8 hand their sections to the orchestrator in their reports).

---

### Task 1: Frontend certification (closes prior-sweep unverified #1)

**Files:** none (verification only; work from repo root)

- [ ] **Step 1:** `npm run build` — expect exit 0; only acceptable warning is the pre-existing >500 kB chunk notice. Record verbatim tail.
- [ ] **Step 2:** `npx vitest run` — expect all test files pass (158+ files, 606+ tests as of 06-28; count grew since). Record `Test Files X passed` / `Tests Y passed` lines verbatim. ANY failure = finding (include full failure output).
- [ ] **Step 3:** `npm audit --omit=dev 2>&1 | tail -5` and `npm audit 2>&1 | tail -5` — record counts only (baseline 06-28: 24 vulns / 12 high, M5 still open). Delta = finding.
- [ ] **Step 4:** `git status` must stay clean. Report section: build/tests/audit table.

### Task 2: Supabase advisors + platform logs (closes prior-sweep unverified #2 and #3)

**Files:** none. MCP only.

- [ ] **Step 1:** `get_advisors` type `security`. Compare against the 06-28 baseline (292 total lints then; 49 RLS-off ERRORs were backup tables since dropped/closed; anon-fn surface closed 2026-07-01). Expected now: no `rls_disabled_in_public` ERRORs, no anon-executable-function findings. List every remaining ERROR-level lint verbatim; WARN-level: counts by category.
- [ ] **Step 2:** `get_advisors` type `performance`. Record counts by category (unindexed FKs — was 39; auth_rls_initplan — was 27; multiple permissive policies — was 26; mutable search_path — was 15) and list the top 10 highest-impact items verbatim. This feeds Task 8.
- [ ] **Step 3:** `get_logs` for `api` and `postgres` (24h window). Scan for: 5xx, statement timeouts (57014), permission denied (42501 — would indicate a grant miss from the 07-01 remediation), RLS violations, OOM. Anything non-benign = finding with the log line verbatim.
- [ ] **Step 4:** If any MCP tool is still classifier-blocked after 3 retries: mark that check UNVERIFIED (do not fall back to the management API) and move on.

### Task 3: Database integrity sweep (re-run of prior sweep §2, all via `execute_sql`, read-only)

**Files:** none.

- [ ] **Step 1 — cron health (3 days):**
```sql
select j.jobname, count(*) filter (where r.status='succeeded') as ok,
       count(*) filter (where r.status='failed') as failed, max(r.start_time) as last_run
from cron.job j left join cron.job_run_details r
  on r.jobid = j.jobid and r.start_time > now() - interval '3 days'
group by j.jobname order by j.jobname;
```
Expected: 0 failed everywhere; drain ~720/day; dailies 3/3. Any failure = finding (pull the failing run's `return_message`).
- [ ] **Step 2 — email pipeline state:** outbox stuck (`select status, count(*) from email_outbox group by status;` — expect no `pending` older than 10 min: `select count(*) from email_outbox where status='pending' and created_at < now() - interval '10 minutes';` → 0), drain heartbeat fresh (`select * from email_pipeline_health();` or the heartbeat table the function reads), failures last 7d grouped by error:
```sql
select left(coalesce(error,'?'),80) as err, count(*) from email_log
 where status in ('failed','error') and created_at > now() - interval '7 days'
 group by 1 order by 2 desc limit 10;
```
Compare vs prior sweep (87: 55×422 invalid-to + 32×429). Quantify the invalid-to P2 now.
- [ ] **Step 3 — orphans & consistency (each expect 0):** payments without deal; payment_lines without payment; jobs without deal; jobs with `parent_job_id` pointing to archived/missing parent; deals with null `accounting_stage_id`; jobs on archived stages; leads `converted_deal_id` pointing nowhere:
```sql
select
 (select count(*) from deal_payments dp where not exists (select 1 from deals d where d.id=dp.deal_id)) as orphan_payments,
 (select count(*) from deal_payment_lines l where not exists (select 1 from deal_payments p where p.id=l.payment_id)) as orphan_lines,
 (select count(*) from jobs j where not exists (select 1 from deals d where d.id=j.deal_id)) as orphan_jobs,
 (select count(*) from jobs j where j.parent_job_id is not null and not exists (select 1 from jobs p where p.id=j.parent_job_id and not p.archived)) as dangling_parents,
 (select count(*) from deals d where d.accounting_stage_id is null and not d.archived) as stageless_deals,
 (select count(*) from leads l where l.converted_deal_id is not null and not exists (select 1 from deals d where d.id=l.converted_deal_id)) as dangling_conversions;
```
- [ ] **Step 4 — billing state:** live duplicate recurring period-keys (expect 0); zero-length windows (only known `984275cd`/deal 000387); stuck on-hold (`on_hold` + `deal_next_due(id)` null — prior sweep: 000039, 000280; still there?); open `data_integrity_alerts`; sentinels 000131/000051/000203/000512/000066 all `paid_in_full`; `select count(*) from deal_payments where status='cancelled';` (report — accounting may have started pausing; each cancelled chain should have a `billing_paused` job:
```sql
select count(*) from deal_payments dp where dp.status='cancelled'
 and not exists (select 1 from jobs j where j.deal_id=dp.deal_id and j.service_type=dp.service_type and j.blocked_reason='billing_paused');
```
expect 0).
- [ ] **Step 5 — security boundary spot check:** anon-executable secdef fns (expect 0); tables without RLS in public (expect 0); new-since-07-01 functions with anon EXECUTE (expect 0 — proves the default-priv hardening holds):
```sql
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and has_function_privilege('anon',p.oid,'EXECUTE');
```
(report the number; investigate any secdef ones).

### Task 4: Billing/state-machine harness re-runs (savepoint-rolled-back on prod)

**Files:** none — run committed harnesses via `execute_sql`, one DO block per call; every block self-aborts with `RESULT ::` raise.

- [ ] **Step 1:** `supabase/tests/payments_accounting_full_smoke.sql` — run ALL scenarios in the file. Compare each RESULT verbatim to the profile in `docs/superpowers/reports/2026-07-02-billing-mitigations-report.md` (79/104 PASS baseline; the non-PASS ones are documented known-issues — a baseline-FAIL scenario that still FAILs identically is NOT a new finding; any flip either direction IS).
- [ ] **Step 2:** `supabase/tests/job_billing_pause_harness.sql` — all 8 (P1–P8), expect 8×PASS (2026-07-02 baseline).
- [ ] **Step 3:** `supabase/tests/paid_in_full_flip_harness.sql` + `paid_in_full_flip_edgecases.sql` — all scenarios, expect the 2026-07-01/02 PASS profile.
- [ ] **Step 4:** targeted email-adjacent harnesses: `supabase/tests/enqueue_payment_reminders.sql`, `supabase/tests/seo_onboarding_reconciler.sql`, `supabase/tests/lead_distribution.sql` — all scenarios, compare to their in-file expected results.
- [ ] **Step 5:** residue check: 0 rows from any harness prefix (`pause_%`, `PAUSE-%`, and the prefixes used inside the other harness files — read their seed names).

### Task 5: Email trigger correctness audit (static, read-only)

**Files:** none. Read deployed bodies via `pg_get_functiondef` + edge function code via `mcp__plugin_supabase_supabase__get_edge_function` (send-email) + repo `supabase/functions/send-email/*`.

The complete email-producing surface (verified live 2026-07-02) — audit EVERY row:

| # | Producer | Fires on | Intended behavior to verify |
|---|---|---|---|
| 1 | `leads_email_automations` (triggers ins+upd on leads) | lead enters Unique Lead stage | enqueues `lead_welcome` from sales@, CC assigned rep; idempotent via email_log check (no dup on re-entry); respects `dept_sales` toggle; skips leads without valid email |
| 2 | `deals_enqueue_won_welcome` (deals) | deal won/created via accounting | `won_welcome` from accounting@, `{{code}} - ` subject prefix; respects `dept_accounting`; no send to `clients.status='done'` |
| 3 | `jobs_seo_onboarding_email` (jobs) | web_seo/local_seo job creation | GSC email (web) / GBP email (local) from support@, passes code+name (cleanSubject safety net); respects `dept_technical`; AI-SEO children handled (children spawn the emails, parent doesn't); no email for billing_only parents |
| 4 | `enqueue_payment_reminders` (daily cron) | due dates −7d/+1d/+7d | respects suppression flag; stops on paid/`cancelled` (positive status list verified 2026-07-02); never-email-closed chokepoint (`clients.status='done'` block, `internal` identity exempt); dedupe so one reminder per payment per offset |
| 5 | `process_email_sequences` (daily cron) | email_sequences rows | only active sequences; respects global/dept gates |
| 6 | `email_notify_new_job` / `email_notify_new_task` (jobs/assigned_tasks) | staff notifications | internal identity (not client-facing); task email links to `/tasks?open=assigned:<id>` (06-30 fix); job email routes correctly |
| 7 | `email_outbox_pulse` + drain cron (2-min `net.http_post` → send-email) | outbox rows | drain secret auth (`email_drain_secret`), `verify_jwt` OFF on send-email; claim/recover functions (`claim_email_outbox`, `recover_stale_email_claims`) service_role-only |
| 8 | send-email edge function (deployed version) | all sends | dept CC routing (accounting→cc accounting@; technical→from+cc support@; lead_welcome→cc rep); `cleanSubject()` strips dangling " - "; DB templates escape HTML; known-open H2 (any authenticated user can single-send — VERIFY still true and record as standing finding); L4 TOCTOU dedupe (unique index on dedupe_key present or absent?) |
| 9 | `resend-webhook` / `auth-email` | delivery status / auth mails | Svix/signature verification still in place (read code, confirm unchanged) |

- [ ] **Step 1:** For rows 1–7: fetch each deployed body (`pg_get_functiondef`), read it against the intended behavior column, and grade PASS / FAIL / PARTIAL with the exact clause that satisfies (or violates) each point. Check dept toggles live: `select * from email_automation_settings;` — record current on/off states.
- [ ] **Step 2:** For row 8: `get_edge_function` (slug `send-email`) — confirm deployed version matches repo (diff against `supabase/functions/send-email/`); verify the routing table, cleanSubject, escaping, and record the H2 authorization status.
- [ ] **Step 3:** Template audit: `select key, updated_at from email_templates order by key;` — all 21+ client-facing keys present; spot-read 3 (lead_welcome, won_welcome, payment_reminder) for `{{code}}` prefix and Greek greeting/sign-off convention.
- [ ] **Step 4:** Data quality quantification (feeds the P2): invalid emails in live tables:
```sql
select 'leads' as t, count(*) from leads where email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and archived_at is null
union all select 'clients', count(*) from clients where email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
union all select 'clients_two_emails', count(*) from clients where email ~ '[,;/ ].*@.*@|@.*[,;/ ].*@';
```
(adjust the two-email regex to what actually matches the known "two emails in one field" rows; report counts + 5 sample rows each, values redacted to domain-only).
- [ ] **Step 5:** Verdict table for all 9 rows + a list of email findings ordered by severity.

### Task 6: Controlled live email end-to-end (ONE real send, internal recipient only)

**Files:** none. This task MUTATES prod in a controlled, reversible way. NO client addresses.

- [ ] **Step 1 — savepoint content checks (nothing sends):** in single DO blocks that always `raise exception 'RESULT :: ...'`:
  - Insert a fake lead directly at the Unique Lead stage with email `info@itdev.gr` → SELECT the `email_outbox` row the trigger enqueued → assert template key = lead_welcome, `to` correct, payload has lead name → raise (rolls back, outbox row evaporates).
  - Insert a fake web_seo job (full seed: client+deal+job) → assert the SEO-onboarding outbox row (template, from support@ identity, code in payload) → raise.
  - Call `enqueue_payment_reminders()` after seeding a payment due tomorrow → assert exactly one reminder row with the right offset → raise.
- [ ] **Step 2 — one real send:** create a REAL throwaway lead (name `SWEEP TEST — DELETE ME`, email `info@itdev.gr`, source `import`) directly in Unique Lead stage. Let the trigger enqueue + the 2-min drain send it. Poll `email_log` (up to 5 min) for status `sent` + Resend id. Verify in the log row: from identity sales@, cc = assigned rep (or none if unassigned — record which), subject correct.
- [ ] **Step 3 — cleanup:** delete the throwaway lead via `select public.delete_leads(array['<id>'::uuid]);` under an admin JWT-claims stub (same incantation as the pause harness: `set_config('request.jwt.claims', json_build_object('sub', <admin uid>)::text, true)` — run RPC and cleanup inside ONE transaction-committing execute_sql call, NOT rolled back). Verify lead gone; email_log row stays (audit). Report the Resend message id.
- [ ] **Step 4:** If the drain doesn't pick up within 5 min → that itself is a P1 finding (pipeline stalled); still clean up the lead.

### Task 7: Live site sweep (Playwright, read-mostly, two roles)

**Files:** none. Credentials supplied by orchestrator at dispatch — never written to disk.

On EVERY page: snapshot, console errors, failed `/rest/v1/*`+`/functions/v1/*`+`/api/*` requests, and coarse load time (navigation → content visible; flag > 4s).

- [ ] **Step 1 — admin pass** (all main routes): dashboard; global search (`000` + a Greek term e.g. `ΚΑΚΑ`); sales kanban (scroll a column, use column "Load more"); /sales/leads (filters + include-won toggle); /sales/lead-intake; a lead detail; a deal detail (Overview/Payments/Jobs/Tasks/Activity/Files tabs); a job detail (all tabs incl. Info + monthly checklist + Billing card); each service board (web_dev, web_seo, local_seo, ai_seo, ads, social_media, hosting) incl. board search where present; /tasks board + Resolved archive; offers list + offer builder (do NOT send); contracts list; accounting onboarding board; accounting report page; expenses; Settings → users/groups/announcements/email-automations/email-health; notifications dropdown.
- [ ] **Step 2 — write probes (safe, self-cleaning):** create+resolve+delete a personal task `sweep-DELETE-ME`; add a comment `sweep test — delete me` on the throwaway artifacts ONLY if Task 6's lead still exists (skip otherwise); open+cancel the job Billing pause dialog; open+cancel a payment edit.
- [ ] **Step 3 — sales rep pass** (tvogiatzi): kanban own view, lead detail, leads page, global search, tasks — verify no admin-only leakage (no Settings, no lead-intake, no delete buttons) and no 403s in normal flow.
- [ ] **Step 4 — report:** route-by-route table (load ok / data ok / console / network / time) + all findings with reproduction notes.

### Task 8: Optimization distillation

**Files:** none. Inputs: Task 2 performance advisors + targeted queries.

- [ ] **Step 1:** From advisors: list unindexed FKs on the 6 hottest tables only (activity_log, comments, attachments, deal_payments, jobs, leads — joins/deletes at scale), the `auth_rls_initplan` policies on tables > 1000 rows, and duplicate-permissive-policy pairs. For each: 1-line impact + 1-line fix.
- [ ] **Step 2:** `pg_stat_statements` top offenders (if available):
```sql
select round(total_exec_time)::bigint as total_ms, calls, round(mean_exec_time)::bigint as mean_ms, left(query, 120) as q
from pg_stat_statements order by total_exec_time desc limit 15;
```
(if the extension isn't enabled, note and skip). Flag anything with mean > 500 ms tied to app queries (RPCs, PostgREST selects).
- [ ] **Step 3:** Table bloat/seq-scan sanity: `select relname, seq_scan, idx_scan, n_live_tup from pg_stat_user_tables where seq_scan > idx_scan and n_live_tup > 5000 order by seq_scan desc limit 10;`
- [ ] **Step 4:** Email pipeline optimization check: drain batch size + 2-min cadence vs the 429 bursts (32/7d prior; Task 3 has fresh numbers) — recommend spacing only if 429s persist. Frontend: the >500 kB chunk (code-split candidates: offer builder, dashboard — from the 06-28 audit).
- [ ] **Step 5:** Output: prioritized optimization list (effort × impact), no implementation.

### Task 9: Consolidated report + trivial cleanups + push

**Files:**
- Create: `docs/superpowers/reports/2026-07-02-full-live-sweep.md`

- [ ] **Step 1:** Assemble all task sections into the report following the structure of `docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md` (scope, per-area tables, "Fixed during sweep", "Open bugs / action items" in priority order, verdict). Include the email-trigger verdict table (Task 5) and the route table (Task 7) in full.
- [ ] **Step 2 — trivial cleanups (ONLY these, each with a backup + verbatim revert noted in the report; skip any that don't apply):** resolve stale `data_integrity_alerts` proven healthy in Task 3; nothing else — anything code/DDL/data-shape becomes a report finding, not a fix.
- [ ] **Step 3:** Commit + push:
```bash
git add docs/superpowers/reports/2026-07-02-full-live-sweep.md docs/superpowers/plans/2026-07-02-full-live-sweep.md
git commit -m "docs: full live sweep — site + DB + email triggers + optimization audit"
git push origin main
```
- [ ] **Step 4:** Memory update (orchestrator): new/updated memory with the sweep verdict + open items.

---

## Changes / Revert

Audit-only. Prod mutations: Task 6's one throwaway lead (deleted in-task; email_log audit row retained deliberately) + Task 9's alert resolutions (revert: re-open the alert ids listed in the report). Repo additions: this plan + the report (revert: `git revert` the docs commit).

## Self-Review

**Spec coverage:** live-site testing ✅ (T7, 2 roles, all routes); database ✅ (T3 integrity, T4 state machine, T2 advisors/logs); find all bugs ✅ (T1 build/tests + consolidated T9); email triggers correct ✅ (T5 static full-surface, T6 live end-to-end, T4 reminder/onboarding harnesses); well optimized ✅ (T2 perf advisors → T8 distillation incl. email cadence + bundle). Prior-sweep unverified items all re-run (T1: build/vitest; T2: advisors/logs).
**Placeholders:** none — every step has exact commands/queries or names the exact committed artifact to execute.
**Consistency:** project id, harness file names, report paths consistent throughout; Task 6 auth stub matches the incantation proven in the pause harness.
