# ITDevCRM — Full Codebase Audit & Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Every database/grant change touches PRODUCTION and requires explicit per-action user approval** (the auto-mode classifier blocks vague authorization).

**Goal:** Surface every real error, bug, security hole, and risk across the whole project, then fix them in priority order to make the system robust.

**Architecture:** React 19 + Vite SPA · Vercel serverless API routes (`api/`) · Supabase Postgres (273 migrations, RLS) + Deno Edge Functions (`supabase/functions/`) · @tanstack/react-query · supabase-js.

**Tech Stack:** TypeScript, Postgres/pg_cron, Resend (email), Sentry.

**Scan date:** 2026-06-28 · Prod project `CRM` (`xujlrclyzxrvxszepquy`), verified live via Management API.

---

## Health scorecard

| Dimension | Result |
|---|---|
| `npm run build` (tsc -b + eslint --max-warnings=0 + vite) | ✅ **PASS** (1 warn: >500 kB JS chunk) |
| `vitest` | ✅ **606 / 606 pass** (151 files) |
| Static hygiene (`any`, `@ts-ignore`, `console.log`, TODO) | ✅ **0 in `src`** |
| Core-table RLS (clients/leads/deals/payments/jobs/profiles) | ✅ **enabled** |
| Accounting engine (crons/blocks/payments) | ✅ verified green (separate smoke test) |
| **DB security advisors** | 🔴 292 lints (49 RLS-off ERROR, 1 sec-definer view, …) |
| **Function grants** | 🔴 110 sec-definer fns anon-executable |
| **Dependencies** | 🟠 24 vulns (12 high) |
| **Code logic (4 reviewers)** | 🟢 no Critical runtime bugs; 1 High authz, several Medium |

**Headline:** the application code is high quality and the core data model is RLS-protected. The serious exposure is at the **grant/permission boundary** (default `PUBLIC`/`anon` grants on functions and leftover tables) and in **`send-email` authorization** — all with clean, low-risk fixes.

---

## PART 1 — FINDINGS (worst first)

### 🔴 CRITICAL

**C1 — 49 leftover backup tables containing PII are readable by `anon`.**
`*_backup_*` / dated one-off tables (e.g. `leads_won_backfill_backup_20260623`, `clients_rebaseline_status_backup_20260619`, `deal_payments_backup_20260619`) have **RLS disabled** AND **`SELECT` granted to `anon` + `authenticated`** (verified: 49 tables each). The anon key ships in the public frontend bundle, so anyone can read historical lead/client/payment PII via `GET /rest/v1/<table>?select=*`.
*Fix:* DROP them (also clears 49 RLS-ERROR + 48 no-PK + several unused-index advisor lints). Keep the most recent (`*_20260628`) until this audit's fixes are confirmed, or move all backups to a private (unexposed) schema.

### 🟠 HIGH

**H1 — ~20 privileged `SECURITY DEFINER` functions are callable by `anon` with no auth guard.**
Default `PUBLIC` execute grant makes these internet-reachable RPC endpoints (`POST /rest/v1/rpc/<fn>`) that run as table owner (bypassing RLS): `enqueue_lead_email`, `enqueue_payment_reminders`, `process_email_sequences` (→ send client emails), `mark_overdue_payments` (→ flip payments + notification-spam every admin), `reconcile_block_lifecycle`, `move_overdue_deals_to_on_hold`, `release_jobs_for_deal`, `release_deal_jobs`, `release_billing_jobs_for_deal`, `block_deal_jobs`, `ensure_recurring_payments(_v2)`, `seed_deal_payments`, `generate_payments_for_deal`, `seed_deal_jobs_and_payments`, `distribute_unassigned_leads`, `pick_next_sales_assignee`, `apply_intake_merge`, `ensure_recurring_expenses`, `run_monthly_task_reset`. Verified: all anon-executable, no `current_user_*`/`auth.uid()` check. `enqueue_lead_email(lead_uuid, tpl, key)` is the sharpest — emits company-domain email to a lead.
*Fix:* `REVOKE EXECUTE ... FROM PUBLIC, anon` on every internal/cron/trigger-helper function; grant `EXECUTE` only to `authenticated` (or no role for cron-only fns). The guarded user-facing RPCs (`delete_leads`, `close_deal`, `accounting_create_deal`, etc., which all check `current_user_is_admin`/capability) stay as-is.

**H2 — `send-email` edge function has no real authorization** (`supabase/functions/send-email/index.ts:218-227`).
Single-send mode only checks "is there a valid JWT" — any authenticated user passes. `identity` (sales/accounting/internal), `to`, and `data` are all caller-controlled; `templateKey:"custom"` hits a passthrough that does **no HTML escaping** (`templates.ts:33-37`). So any logged-in user (all 7 sales reps today) can send DKIM/SPF-signed mail from `accounting@`/`sales@`/`support@` to any address with arbitrary HTML. **Becomes Critical when the client portal ships** (client accounts are "authenticated" too).
*Fix:* require `profiles.is_admin` or an `email.send` capability before `sendOne`; whitelist `identity`/`templateKey` per caller; validate `to` with the `[\r\n]`/email check already used in `sendPersonal`; never allow the unescaped `custom` passthrough from a non-service caller.

### 🟡 MEDIUM

**M1 — Stack traces returned to clients** — `api/offer-pdf.ts:72-77`, `api/contract-pdf.ts:16-20` put `e.stack` in the HTTP 500 body. Leaks server paths/internals. *Fix:* return `{error:'internal_error'}`; keep stack in Sentry only.

**M2 — Webhook/lookup secrets accepted in query string** — `api/meta-lead.ts:110` (`data.key` fallback, on a GET that inserts) and `api/pbx-lookup.ts:51` (`req.query.key`). Secrets leak into Vercel/CDN logs; once leaked, `pbx-lookup` allows phone→PII enumeration. *Fix:* header-only secret; rotate `META_LEAD_SECRET` + `PBX_LOOKUP_SECRET`.

**M3 — Unescaped built-in email templates** — `supabase/functions/send-email/templates.ts:43-86` interpolate `client_name`/`title` into HTML raw (the DB-template path escapes; these don't). HTML/phishing injection via fields lower-priv users set. *Fix:* escape all interpolations like `renderDbTemplate` does.

**M4 — `user_effective_permissions` SECURITY DEFINER view is anon-readable** — no `security_invoker`, no `auth.uid()` filter, `SELECT` granted to `anon`+`authenticated`. Leaks the full per-user permission matrix (incl. which user_ids are admin). *Fix:* `REVOKE` from anon; recreate `WITH (security_invoker=true)` or filter to `auth.uid()`.

**M5 — 24 dependency vulnerabilities (12 high)** — mostly transitive build tooling (`undici`, `ws`, `hono`, `vite`, `path-to-regexp`, `minimatch`, `@vercel/*`), but `react-router`/`react-router-dom` (DoS + CSRF) and `dompurify` (sanitizer bypass) are runtime. *Fix:* `npm audit fix`, bump `react-router-dom`/`dompurify`/`vite` to patched majors, re-run build+tests.

**M6 — Offer `sent_at` is wiped on any non-`sent` transition** — `src/features/offers/hooks/useUpdateOfferStatus.ts:16` writes `sent_at:null` for every status that isn't `sent`. Moving draft→sent→accepted destroys the real "sent" timestamp (feeds follow-up logic + audit). *Fix:* only stamp on entry to `sent`; never clear it otherwise.

**M7 — Offer builder name/email overrides are dead state** — `OfferBuilderPage.tsx` renders editable `clientNameOverride`/`emailOverride` inputs that `onSubmit` never sends; the offer always derives recipient from `lead_id`. Silent no-op in a quoting flow. *Fix:* wire them through `useCreateOffer`, or remove the inputs.

**M8 — `PaymentsPanel` swallows all mutation errors** — `src/features/deals/PaymentsPanel.tsx:69-71,222-239` fire `void mutateAsync(...)` with no `.catch`, and `submitNew` closes/clears the form unconditionally. A failed payment insert/edit looks successful (sibling `JobsBillingPanel` does this right). *Fix:* `.catch(reportError)` + only close on success.

**M9 — `release_deal_jobs` strands `partial_payment_pending` blocks on hosting / AI-SEO-parent jobs at Paid-In-Full** — the live function clears those reasons only for `web_seo/local_seo/ads/social_media`; for other services it clears only `account_on_hold`. A fully-paid client's hosting/AI-SEO card stays frozen unless "Complete accounting" was used. **0 current victims** (`partial_payment_pending_jobs = 0`), latent. *Fix:* in the second UPDATE clear `blocked_reason in ('account_on_hold','partial_payment_pending')`.

**M10 — Migration files drift from production** — for several payment-lifecycle objects, the live DB ≠ the `.sql` files (e.g. prod runs trigger `deal_payments_release_from_on_hold`; the files say `deal_payments_settle_to_paid_in_full`, which doesn't exist in prod). A `supabase db reset` or a developer trusting the files would get wrong behavior. *Fix:* generate a reconciliation migration capturing true prod state (`supabase db pull` / dump live `pg_get_functiondef`), so the repo matches prod.

### 🟢 LOW / POLISH

- **L1** `api/offer-pdf.ts:107`, `api/contract-pdf.ts:51` — user-scoped client built with `service_role` apikey + user JWT; RLS holds today but a dropped header silently falls back to full service-role. Use `ANON_KEY`.
- **L2** `send-email/index.ts:196`, `_shared/google.ts:28` — non-constant-time secret/MAC compare (`===`/`!==`); a `timingSafeEqual` helper already exists. Use it.
- **L3** `api/unsubscribe.ts:24-50` — opt-out is a GET; link prefetchers can auto-unsubscribe recipients. Confirm on POST.
- **L4** `send-email/index.ts:41-44,163-166` — direct single-send dedupe is TOCTOU; two concurrent same-key calls can double-send. Add a unique index on `dedupe_key where status='sent'`.
- **L5** `invite_user/index.ts:48-76` — missing `group_codes` validation throws *after* `createUser`, orphaning an auth user. Validate up front.
- **L6** `NewExpenseDialog.tsx:13-23` — `setUTCMonth(+1)` overflows month-end starts (Jan 31 → Mar 3). Clamp to month end.
- **L7** `useConvertLead.ts:18-23` — doesn't invalidate `queryKeys.lead(leadId)`; lead detail shows stale post-conversion.
- **L8** `GlobalSearch.tsx:100` — Enter navigates via `window.location.href` (full reload, drops cache). Use router `navigate`.
- **L9** `LeadRowEditor.tsx:60-61` — `setTimeout` for the "saved" flash not cleared on unmount (benign in React 18).
- **L10** `ensure_recurring_payments` has no €0 floor — rolls €0 amounts forward for **2** active recurring jobs (down from the historical 117; mostly backfilled). Backfill the 2, optionally skip/warn on €0.
- **L11** `deal_payments_default_service_keys` can reuse a series index for a 2nd identical recurring service (NULL-index insert paths only) → series collapse. Allocate the next free index.

### ⚙️ PERFORMANCE / HARDENING (advisor-level)

- 39 **unindexed foreign keys** (activity_log, attachments, comments, deals, jobs, leads, …) → slow joins/deletes at scale. Add covering indexes.
- 27 **`auth_rls_initplan`** — RLS policies call `auth.uid()` per-row instead of `(select auth.uid())` (deals, leads, profiles, comments, attachments, …). Wrap in a scalar subselect.
- 26 **multiple permissive policies** on the same table/action (deal_payments, jobs, profiles, …) — consolidate.
- 15 functions with **mutable search_path** — add `SET search_path = public`.
- **>500 kB JS chunk** — code-split heavy routes (offer builder, dashboard) with dynamic `import()`.

### ✅ VERIFIED CLEAN (no action)
Core-table RLS; supabase `.bind` detached-`this` (all module captures bound); realtime channel cleanup; integer-cents money math + Cyprus 0% VAT; AI-SEO trio billing (no double-bill); owner/close triggers; cron idempotency (reminders/monthly-reset/distribution dedupe); FK cascades; `resend-webhook` (Svix) + `auth-email` (signature) verification; AES-GCM token crypto in `_shared/google.ts`; PDF template escaping.

---

## PART 2 — REMEDIATION PLAN (phased, bite-sized)

> Phases are ordered by risk-reduction per unit effort. Phase 1 = security, do first. Each DB task needs explicit user approval to apply on prod, takes a backup, and ships as a migration with a rollback block (per the project's change-tracking rule).

### Phase 1 — Close the security holes (highest priority)

#### Task 1.1: Drop / quarantine leftover backup tables (C1)
**Files:** Create `supabase/migrations/20260628010000_drop_leftover_backup_tables.sql`
- [ ] Step 1 — Enumerate exactly: `select tablename from pg_tables where schemaname='public' and (tablename ~* 'backup|resweep' or tablename ~* '_2026[0-9]{4}$');` Review the list with the user; keep `deal_payments_overdue_backfill_backup_20260628` until Phase-1 verified.
- [ ] Step 2 — Migration body: `DROP TABLE IF EXISTS public.<each> CASCADE;` for every confirmed table.
- [ ] Step 3 — Apply via Management API; re-run the security advisor and confirm `rls_disabled_in_public` ERROR count drops by ~46.
- [ ] Step 4 — Rollback note: tables are disposable historical snapshots; if one is still needed, restore from the migration that created it. Commit.

#### Task 1.2: Revoke PUBLIC/anon execute on internal functions (H1)
**Files:** Create `supabase/migrations/20260628020000_revoke_internal_fn_grants.sql`
- [ ] Step 1 — Build the target list: sec-definer, non-trigger, write/email/cron functions NOT meant as user RPCs (the ~20 in H1 + every `ensure_*`/`seed_*`/`enqueue_*`/`process_*`/`run_*`/`reconcile_*`/`release_*`/`block_*`/`generate_*`).
- [ ] Step 2 — `REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon;` for each (use identity args). For app-needed ones, `GRANT EXECUTE ... TO authenticated;` (cron-only fns need no grant — pg_cron runs as postgres).
- [ ] Step 3 — Apply; verify `select count(*) ... where prosecdef and has_function_privilege('anon',oid,'EXECUTE')` dropped to only the intended guarded RPCs.
- [ ] Step 4 — Smoke-test the app (login as admin + a sales rep): board loads, RPCs the UI calls still work. Commit with rollback (re-`GRANT ... TO PUBLIC`).

#### Task 1.3: Harden `send-email` authorization (H2)
**Files:** Modify `supabase/functions/send-email/index.ts:218-227`, `templates.ts:33-37`
- [ ] Step 1 — After `getUser()`, fetch caller `profiles.is_admin` (service-role client); reject non-admin unless an `email.send` capability is added. Redeploy with `verify_jwt:false` preserved (cron path).
- [ ] Step 2 — Validate `to` against the `sendPersonal` `[\r\n]`/email regex in the `sendOne` path; reject the `custom` template for non-service callers.
- [ ] Step 3 — Live test: admin send works; non-admin send returns 403; existing cron/instant-send path unaffected.

#### Task 1.4: Lock down `user_effective_permissions` view (M4)
**Files:** Create `supabase/migrations/20260628030000_secure_user_perms_view.sql`
- [ ] Step 1 — `CREATE OR REPLACE VIEW public.user_effective_permissions WITH (security_invoker=true) AS <existing def>;` then `REVOKE ALL ON public.user_effective_permissions FROM anon;`
- [ ] Step 2 — Verify the app's own-permission query still returns the caller's rows; confirm a second user can't read another's. Commit.

#### Task 1.5: Stop leaking secrets/stack traces (M1, M2, M3)
**Files:** `api/offer-pdf.ts`, `api/contract-pdf.ts`, `api/meta-lead.ts`, `api/pbx-lookup.ts`, `supabase/functions/send-email/templates.ts`
- [ ] Step 1 — Remove `stack`/raw `message` from PDF 500 responses → `{error:'internal_error'}`.
- [ ] Step 2 — Drop the `data.key`/`req.query.key` secret fallbacks (header-only); rotate `META_LEAD_SECRET` + `PBX_LOOKUP_SECRET` in Vercel.
- [ ] Step 3 — Escape interpolations in the built-in `TEMPLATES`. Build + deploy. Commit.

### Phase 2 — Correctness fixes (data integrity)
- [ ] **Task 2.1 (M6):** `useUpdateOfferStatus` — stamp `sent_at` only on entry to `sent`; never clear. Add/adjust a unit test.
- [ ] **Task 2.2 (M8):** `PaymentsPanel` — add `.catch(reportError)` to `commit`/`submitNew`/`toggleStatus`; close add-form only on success.
- [ ] **Task 2.3 (M7):** OfferBuilder — wire `clientNameOverride`/`emailOverride` through `useCreateOffer`, or remove the inputs (decide with user).
- [ ] **Task 2.4 (M9):** `release_deal_jobs` migration — second UPDATE clears `blocked_reason in ('account_on_hold','partial_payment_pending')`.
- [ ] **Task 2.5 (L10):** backfill `jobs.amount_net` for the 2 €0 recurring jobs; add a €0 skip/warn in `ensure_recurring_payments`.

### Phase 3 — Dependencies + migration hygiene
- [ ] **Task 3.1 (M5):** `npm audit fix`; bump `react-router-dom`, `dompurify`, `vite` to patched versions; re-run `npm run build` + `vitest`; fix breakage.
- [ ] **Task 3.2 (M10):** reconciliation migration capturing true prod state for the drifted payment-lifecycle functions/triggers (dump live `pg_get_functiondef`), so files == prod.

### Phase 4 — Low-severity + performance (batch when convenient)
- [ ] L1–L9 polish fixes (one small commit each).
- [ ] Add the 39 missing FK indexes (one migration).
- [ ] Rewrite the 27 `auth_rls_initplan` policies to `(select auth.uid())`; consolidate the 26 duplicate permissive policies.
- [ ] Add `SET search_path = public` to the 15 flagged functions.
- [ ] Code-split the >500 kB chunk (dynamic import on offer builder / dashboard).

---

## Appendix — methodology
Build/lint/test run locally; `npm audit`; Supabase security+performance advisors via Management API; live trigger/grant/RLS introspection via `pg_*` catalogs; 4 specialist subagents (API/edge, frontend runtime, DB-logic) reading the actual source; every agent claim cross-checked against the live DB (which caught one inverted finding — prod-drift). No production data was mutated during this audit.
