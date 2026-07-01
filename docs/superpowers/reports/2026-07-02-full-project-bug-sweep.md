# Full Project Bug Sweep (2026-07-02)

**Scope:** everything — frontend typecheck/lint/tests, cron run history, email pipeline, data-integrity orphan sweeps, GRANT-boundary security (open item from the 2026-06-28 audit), RLS coverage, billing sentinels, Supabase advisors/logs.

**Environment note:** a Claude-harness safety-classifier outage during the sweep blocked all non-read-only Bash (so `eslint`/`vite build`/`vitest` could not execute this run) plus the `get_advisors`/`get_logs` MCP tools. Everything reachable via read-only Bash and `execute_sql` ran in full. The blocked items are listed under "Unverified this run" and should be re-run when the environment recovers.

---

## 1. Frontend — build + tests

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit` on all 3 project refs incl. `tsconfig.app.json` with `noUncheckedIndexedAccess`) | ✅ exit 0, zero errors |
| `eslint --max-warnings=0` | ⏸ UNVERIFIED (harness outage) |
| `vite build` bundle | ⏸ UNVERIFIED (harness outage) |
| `vitest` full suite (158 test files) | ⏸ UNVERIFIED (harness outage) |
| Dirty tree | ✅ clean — zero modified tracked files; only 3 untracked plan docs |
| Dependencies (`npm ls`) | ✅ clean (5 benign extraneous wasm helpers) |
| `@ts-ignore` / `@ts-expect-error` / `FIXME` / `TODO` in src | ✅ **zero** occurrences |

Last fully-green build+suite: 2026-07-01 during the notification work; nothing in `src/` has changed since (tree clean), so risk of a silent regression is low — but re-run `npm run build` + `npx vitest run` to certify.

## 2. Database integrity + ops

| # | Check | Result |
|---|---|---|
| 2.1 | Cron run health (3 days, all 10 jobs) | ✅ zero failures; drain 2160 runs, all dailies 3/3 |
| 2.2 | Email outbox | ✅ 0 pending/stuck; 11 failed all admin-cancelled via Email Health page |
| 2.3 | Email failures (7d) | ⚠ **87** — 55× Resend 422 invalid-`to` (phone numbers stored in lead email fields, e.g. `"306986569556"`), 32× Resend 429 rate-limit (last 06-27) |
| 2.4 | Drain heartbeat | ✅ fresh (19:40 UTC) |
| 2.5 | Orphan payments / jobs / dangling parents / stageless deals / jobs-on-archived-stage | ✅ all 0 |
| 2.6 | Orphan payment lines | ⚠ was **1** → **FIXED in this sweep** (deleted; row preserved below) |
| 2.7 | Stuck on-hold deals (`on_hold` + nothing owed) | ⚠ **2** — `000039`, `000280` (see actions) |
| 2.8 | Zero-length recurring windows | ✅ only the known `984275cd`/deal 000387 row; no new ones |
| 2.9 | Open `data_integrity_alerts` | ⚠ was 6 → **5 resolved in this sweep**, 1 kept open (000039, the genuine stuck deal) |
| 2.10 | Live recurring duplicate period-keys | ✅ 0 (S4 UNIQUE index + `cancelled` predicate live) |
| 2.11 | Billing sentinels (000131/000051/000203/000512/000066) | ✅ all `paid_in_full` |

**Orphan line (deleted 2026-07-02; preserved verbatim):**
```json
{"id":"a0dc2ba4-f3fc-46db-b889-33cc88aa8040","payment_id":"75dedd3b-6f78-4b9a-8fcd-ae033f196ff6","job_id":null,"label":"ai_seo","amount_net":"100.00","vat_rate":"24.00","vat_amount":"24.00","amount_gross":"124.00","created_at":"2026-07-01 08:20:58.493275+00"}
```
The `deal_payment_lines → deal_payments` FK is `ON DELETE CASCADE` and validated, so this orphan implies its parent payment was deleted through a path that bypassed the cascade (constraint-trigger-disabled session). One-off; unlinkable (`job_id` null); no financial impact (line rows are display metadata).

**Alert triage (6 open → 1):**
| Deal | Stage now | next_due now | Disposition |
|---|---|---|---|
| 000051 | paid_in_full | 2026-07-07 (future) | ✅ healthy → resolved |
| 000090 | paid_in_full | null | ✅ healthy → resolved |
| 000092 | on_hold | 2026-06-05 | legit overdue — flip was CORRECT → resolved |
| 000289 | on_hold | 2026-06-30 | legit overdue → resolved |
| 000382 | on_hold | 2026-06-25 | legit overdue → resolved |
| **000039** | on_hold | **null** | ⚠ STUCK (nothing owed, held by the no-auto-release gate) → **kept open** |

## 3. Security — GRANT boundary (re-check of the 2026-06-28 audit)

| Check | Audit (06-28) | This sweep (pre-fix) | After this sweep |
|---|---|---|---|
| anon-readable backup tables | 49 | 10 (originals fixed; every backup since 06-29 re-introduced it, incl. our own `deal_payments_flipflop_backup_20260701`) | ✅ **0** — revoked `anon` + `authenticated` on all 10 |
| anon-executable SECURITY DEFINER fns | ~20 | ⚠ **107** (regressing — Postgres default grants EXECUTE to PUBLIC on every new function) | ⚠ 107 — NOT touched (too broad for a sweep; needs the 06-28 remediation plan) |
| Tables without RLS | — | only the 10 backup tables; **zero** non-backup tables | ✅ backups now also grant-revoked |

**Root cause of the regression:** Postgres grants `EXECUTE` to `PUBLIC` on new functions and Supabase's default privileges expose new tables to `anon`/`authenticated` unless revoked. Every migration that adds a function or backup table silently re-opens the boundary. **Recommendation (P1):** run the 2026-06-28 remediation plan AND add an `ALTER DEFAULT PRIVILEGES ... REVOKE` (or an event-trigger) so new objects are closed by default; add "revoke anon/authenticated" to the migration checklist (the flip-fix migrations did this for their RPCs; the backup tables were missed).

## 4. Unverified this run (harness outage — re-run when environment recovers)

1. `npm run build` (eslint + vite halves) and `npx vitest run` (158 files).
2. `get_advisors` (security + performance).
3. `get_logs` (api / postgres, 24 h error scan).

## 5. Findings & verdict

### Fixed during this sweep
- 🔧 Orphan `deal_payment_lines` row deleted (preserved above).
- 🔧 5 stale `flip_out_of_paid_in_full` alerts resolved.
- 🔧 10 backup tables closed to `anon` + `authenticated`.

### Open bugs / action items (priority order)
1. 🔴 **P1 — GRANT-boundary regression: 107 anon-executable SECURITY DEFINER functions.** Execute the 2026-06-28 remediation plan + default-privileges hardening. This is the only finding with real security weight; most functions gate internally on `auth.uid()`, but the surface keeps growing.
2. 🟡 **P2 — Lead email data quality: 55 invalid-`to` failures/7d.** Phone numbers stored in lead email fields keep hitting Resend 422. Fix: validate email format at intake/import (`leadImport.ts` + intake release) + one-shot backfill nulling non-email values (pattern exists from the 06-24 dedup work).
3. 🟡 **P2 — 2 stuck on-hold deals (000039, 000280).** Nothing owed, held by the intentional no-auto-release gate. 10-second fix for accounting per deal — or run: `select public.accounting_mark_paid_in_full('<deal_id>');` after eyeballing each. 000039's integrity alert stays open as the tracker.
4. 🟢 **P3 — Resend 429 rate-limits (32/7d, last 06-27).** Bursts from the instant-send pulse. If it recurs, add spacing in the drain batch.
5. 🟢 **P3 — deal 000387 zero-length window row + the orphan-line's cascade-bypass source.** Data archaeology; no active harm (S4 index prevents recurrence of the dupe class).
6. ⏸ Re-run the 4 unverified checks (Section 4).

### Verdict

**No new functional bugs in the application logic.** Accounting/payments (the week's focus) is fully green — sentinels, dupes, crons, pipeline all clean. The material finding is the **security-grant regression** (item 1), which is a known, planned-but-unexecuted remediation — now partially closed (backup tables) with the function surface remaining.
