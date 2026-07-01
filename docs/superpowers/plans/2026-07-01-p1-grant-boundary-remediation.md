# P1 GRANT-Boundary Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every DB step touches PRODUCTION** (Supabase project `CRM`, id `xujlrclyzxrvxszepquy`) — apply DDL only via the Supabase MCP `apply_migration` tool, never via Bash/psql (the harness safety classifier hard-blocks prod DDL over Bash).

**Goal:** Close the P1 finding from the 2026-07-02 bug sweep — 107 SECURITY DEFINER functions executable by the `anon` role over the public REST API — and stop the regression class permanently via default-privileges hardening.

**Architecture:** One migration does three things: (1) a DO-loop revokes `PUBLIC/anon/authenticated` EXECUTE from every secdef function in `public` that `anon` can currently execute and grants `service_role`; (2) explicit `GRANT EXECUTE … TO authenticated` re-opens exactly the 49 functions the frontend calls or RLS policies reference; (3) `ALTER DEFAULT PRIVILEGES` removes `anon` (and the residual `PUBLIC` function default) from all future `postgres`-created objects in `public`. Verification = catalog assertions + live browser smoke (admin + sales rep).

**Tech Stack:** Supabase Postgres (prod), Supabase MCP (`execute_sql`, `apply_migration`, `get_advisors`), Playwright MCP for smoke, git push direct to `main` (no PRs).

---

## Research base (verified live 2026-07-01)

- **107 anon-executable SECURITY DEFINER functions** in `public` (enumeration query in Task 2). They exist because the default ACL for objects created by `postgres` in `public` grants `anon=X, authenticated=X, service_role=X` — every migration since the 06-28 audit fix silently re-opened the boundary.
- **Classification of the 107** (each verified):
  - **49 must keep `authenticated`**: 46 RPCs called from the frontend (`src/lib/rpc.ts` `rpcCall(…)`, `supabase.rpc(…)` — includes `email_outbox_retry/cancel` via variable and `my_google_status` via cast) + 3 RLS-policy helpers (`current_user_is_admin` in 71 policies, `current_user_in_group` in 3, `is_task_party` in 2; `current_user_can` is both UI-called and in 30 policies).
  - **46 trigger functions**: EXECUTE privilege is checked at trigger *creation* time, not fire time → revoking all roles cannot break trigger firing (incl. `handle_new_auth_user` on `auth.users`).
  - **12 internal helpers**: called only from inside other secdef functions or pg_cron (cron runs as `postgres`, the function owner → no grant needed): `apply_intake_reengage_merge`, `email_automation_enabled`, `is_client_blocked`, `lead_email_payload`, `lead_is_dead_end`, `recompute_deal_job_period_dates`, `recompute_job_period_dates`, `reconcile_payment_integrity`, `reconcile_seo_onboarding_emails`, `sales_pool_ids`, `seo_onboarding_pending_jobs`, `team_lead_for_group`.
- **Deliberate earlier grants are untouched**: the ~20 cron/email functions fixed after the 06-28 audit (`enqueue_lead_email`, `mark_overdue_payments`, `ensure_recurring_payments`, `global_search`, `apply_lead_shuffle`, …) already have `anon=false` — the DO-loop predicate (`has_function_privilege('anon', oid, 'EXECUTE')`) skips them by construction.
- **No hidden dependents**: no view references any secdef function; the only function-valued column default in `public` is `leads.code → generate_lead_code()` (not secdef, not in the 107); RLS policies reference only the 4 helpers listed above.
- **`sales_kanban_counts` is NOT secdef** (security invoker, RLS applies) — anon-executable today but out of P1 scope; the default-privileges change plus checklist covers the class going forward.
- **Default ACLs today** (`pg_default_acl`): `postgres`-created functions/tables/sequences in `public` all grant `anon`+`authenticated`+`service_role`. The `supabase_admin` default ACL can NOT be altered by `postgres` (not a member) — acceptable: migrations/MCP/mgmt-API all create objects as `postgres`.

## Decisions locked in

1. **`authenticated` stays open by default** for *future* functions (only `anon`/`PUBLIC` are default-revoked). Rationale: a forgotten grant on a new UI RPC would silently break features for staff; internal functions instead get an explicit `REVOKE … FROM authenticated` via the migration checklist (Task 5). The internet-facing (`anon`) regression class is what P1 is about, and that is closed permanently.
2. **`service_role` gets an explicit grant on all 107** — matches the precedent from the earlier H1 fix; edge functions and scripts use the service key.
3. Forward migration uses a **DO-loop keyed on the regression predicate** (self-healing if a new secdef fn appeared since enumeration); rollback embeds the **explicit 107-function list** (can't be recomputed post-revoke). Task 2 asserts live state == embedded list before applying.
4. Out of scope (unchanged from the audit backlog): `user_effective_permissions` view (M4), `send-email` authorization (H2), non-secdef functions' grants.

---

### Task 1: Write the migration file

**Files:**
- Create: `supabase/migrations/20260701230000_revoke_secdef_fn_grants.sql`

- [ ] **Step 1: Create the migration file with exactly this content**

```sql
-- ============================================================================
-- P1 security remediation (2026-07-01)
-- Context: docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md §3
--   107 SECURITY DEFINER functions in `public` were executable by `anon`
--   (internet-reachable via POST /rest/v1/rpc/<fn> with the public anon key)
--   because the default ACL grants anon/authenticated on every new function.
-- This migration:
--   §1 revokes PUBLIC/anon/authenticated EXECUTE on every secdef function
--      that anon can currently execute, and grants service_role;
--   §2 re-grants authenticated on the 49 functions the frontend calls or
--      RLS policies reference;
--   §3 hardens default privileges so future postgres-created objects in
--      `public` are closed to anon (and functions to PUBLIC) by default.
-- Deliberately untouched: functions already fixed after the 2026-06-28 audit
-- (their anon EXECUTE is already false, so the §1 predicate skips them).
-- ============================================================================

-- §1 — close the regressed surface -----------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end $$;

-- §2 — re-grant authenticated on UI-called RPCs + RLS helper functions (49)
grant execute on function public.accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text) to authenticated;
grant execute on function public.accounting_mark_paid_in_full(uuid) to authenticated;
grant execute on function public.assignable_owners() to authenticated;
grant execute on function public.block_client(uuid,text) to authenticated;
grant execute on function public.block_job(uuid,text) to authenticated;
grant execute on function public.bulk_merge_intake(integer) to authenticated;
grant execute on function public.bulk_merge_intake_preview() to authenticated;
grant execute on function public.bulk_release_intake(integer) to authenticated;
grant execute on function public.bulk_release_intake_preview() to authenticated;
grant execute on function public.close_deal(uuid,jsonb) to authenticated;
grant execute on function public.complete_accounting(uuid) to authenticated;
grant execute on function public.convert_lead_to_client(uuid) to authenticated;
grant execute on function public.create_announcement(text,text,text,boolean,uuid[],timestamp with time zone) to authenticated;
grant execute on function public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text,jsonb,boolean) to authenticated;
grant execute on function public.current_user_can(text,text) to authenticated;
grant execute on function public.current_user_in_group(text) to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_scope(text,text) to authenticated;
grant execute on function public.delete_announcement(uuid) to authenticated;
grant execute on function public.delete_jobs(uuid[]) to authenticated;
grant execute on function public.delete_leads(uuid[]) to authenticated;
grant execute on function public.discard_lead_intake(uuid) to authenticated;
grant execute on function public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.email_failure_rows() to authenticated;
grant execute on function public.email_outbox_cancel(uuid) to authenticated;
grant execute on function public.email_outbox_retry(uuid) to authenticated;
grant execute on function public.email_pipeline_health() to authenticated;
grant execute on function public.email_queue_rows() to authenticated;
grant execute on function public.end_job(uuid) to authenticated;
grant execute on function public.ensure_job_monthly_task_period(uuid) to authenticated;
grant execute on function public.find_contact_by_phone(text) to authenticated;
grant execute on function public.find_lead_duplicates(text,text) to authenticated;
grant execute on function public.get_my_announcements() to authenticated;
grant execute on function public.import_leads_to_intake(jsonb) to authenticated;
grant execute on function public.is_task_party(uuid,uuid) to authenticated;
grant execute on function public.job_billing_ref_count(uuid) to authenticated;
grant execute on function public.lead_cold_ids(uuid[]) to authenticated;
grant execute on function public.lead_dead_end_ids(uuid[]) to authenticated;
grant execute on function public.lock_deal(uuid) to authenticated;
grant execute on function public.mentionable_users() to authenticated;
grant execute on function public.merge_lead_intake(uuid,uuid) to authenticated;
grant execute on function public.my_google_status() to authenticated;
grant execute on function public.reengage_lead_intake(uuid,uuid) to authenticated;
grant execute on function public.release_lead_intake(uuid,boolean) to authenticated;
grant execute on function public.set_announcement_active(uuid,boolean) to authenticated;
grant execute on function public.set_job_monthly_task(uuid,text,boolean) to authenticated;
grant execute on function public.unblock_client(uuid) to authenticated;
grant execute on function public.unblock_job(uuid) to authenticated;
grant execute on function public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text,jsonb) to authenticated;

-- §3 — default-privileges hardening (postgres-created objects in `public`)
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ============================================================================
-- ROLLBACK (verbatim — restores the pre-migration state)
-- ============================================================================
-- §3 revert:
--   alter default privileges for role postgres in schema public grant execute on functions to anon;
--   alter default privileges for role postgres in schema public grant all on tables to anon;
--   alter default privileges for role postgres in schema public grant all on sequences to anon;
--   -- (PUBLIC had no default-ACL entry before either; the §3 PUBLIC revoke was belt-and-braces.)
--
-- §1/§2 revert: re-grant anon + authenticated on the exact 107 functions
-- (service_role grants and the 49 authenticated grants of §2 match pre-state
--  and need no revert). Pre-state ACL on each was
--  {postgres=X, anon=X, authenticated=X, service_role=X}.
--
--   do $rollback$
--   declare fn text;
--   begin
--     foreach fn in array array[
--       -- 49 UI/RLS (anon re-grant only; authenticated already granted by §2)
--       'accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text)',
--       'accounting_mark_paid_in_full(uuid)','assignable_owners()',
--       'block_client(uuid,text)','block_job(uuid,text)',
--       'bulk_merge_intake(integer)','bulk_merge_intake_preview()',
--       'bulk_release_intake(integer)','bulk_release_intake_preview()',
--       'close_deal(uuid,jsonb)','complete_accounting(uuid)',
--       'convert_lead_to_client(uuid)',
--       'create_announcement(text,text,text,boolean,uuid[],timestamp with time zone)',
--       'create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text,jsonb,boolean)',
--       'current_user_can(text,text)','current_user_in_group(text)',
--       'current_user_is_admin()','current_user_scope(text,text)',
--       'delete_announcement(uuid)','delete_jobs(uuid[])','delete_leads(uuid[])',
--       'discard_lead_intake(uuid)','dismiss_announcement(uuid)',
--       'email_failure_rows()','email_outbox_cancel(uuid)','email_outbox_retry(uuid)',
--       'email_pipeline_health()','email_queue_rows()','end_job(uuid)',
--       'ensure_job_monthly_task_period(uuid)','find_contact_by_phone(text)',
--       'find_lead_duplicates(text,text)','get_my_announcements()',
--       'import_leads_to_intake(jsonb)','is_task_party(uuid,uuid)',
--       'job_billing_ref_count(uuid)','lead_cold_ids(uuid[])','lead_dead_end_ids(uuid[])',
--       'lock_deal(uuid)','mentionable_users()','merge_lead_intake(uuid,uuid)',
--       'my_google_status()','reengage_lead_intake(uuid,uuid)',
--       'release_lead_intake(uuid,boolean)','set_announcement_active(uuid,boolean)',
--       'set_job_monthly_task(uuid,text,boolean)','unblock_client(uuid)',
--       'unblock_job(uuid)',
--       'update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text,jsonb)',
--       -- 46 trigger functions
--       'assigned_tasks_notify_assignee()','assigned_tasks_notify_creator()',
--       'assigned_tasks_notify_started()','assigned_tasks_populate_source()',
--       'assigned_tasks_stamp_resolved()','deal_payment_lines_recompute_job_dates()',
--       'deal_payment_lines_recompute_on_delete()','deal_payments_created_at_immutable()',
--       'deal_payments_default_service_keys()','deal_payments_move_to_awaiting()',
--       'deal_payments_no_duplicate_period()','deal_payments_recompute_job_dates()',
--       'deal_payments_recompute_on_delete()','deal_payments_release_from_on_hold()',
--       'deal_payments_seed_after_insert()','deals_close_jobs_on_close()',
--       'deals_enqueue_won_welcome()','deals_hold_jobs_on_stage_change()',
--       'deals_release_jobs_on_partial_payment()','deals_sync_client_status_on_stage_change()',
--       'email_log_set_client_id()','email_notify_new_job()','email_notify_new_task()',
--       'email_outbox_pulse()','enforce_no_stage_move_when_blocked()',
--       'fanout_mention_notifications()','handle_new_auth_user()',
--       'jobs_backfill_payment_service_type()','jobs_local_seo_owner()',
--       'jobs_seed_local_profile_url()','jobs_seed_web_website()',
--       'jobs_seo_onboarding_email()','jobs_web_seo_owner()',
--       'lead_intake_auto_merge()','lead_intake_auto_release()',
--       'leads_auto_distribute()','leads_email_automations()',
--       'leads_enforce_stage_restriction()','leads_sync_stage_on_scheduled_for()',
--       'log_activity()','log_email_activity()','offers_after_insert_set_offer_sent()',
--       'sync_deal_pricing_from_jobs()','task_comments_notify_other_party()',
--       'user_tasks_notify_creator()','user_tasks_notify_started()',
--       -- 12 internal helpers
--       'apply_intake_reengage_merge(uuid,lead_intake)','email_automation_enabled(text)',
--       'is_client_blocked(uuid)','lead_email_payload(leads)','lead_is_dead_end(uuid)',
--       'recompute_deal_job_period_dates(uuid)','recompute_job_period_dates(uuid)',
--       'reconcile_payment_integrity()','reconcile_seo_onboarding_emails()',
--       'sales_pool_ids()','seo_onboarding_pending_jobs()','team_lead_for_group(text)'
--     ]
--     loop
--       execute format('grant execute on function public.%s to anon, authenticated', fn);
--     end loop;
--   end $rollback$;
-- ============================================================================
```

- [ ] **Step 2: Sanity-check the file**

Run: `grep -c "^grant execute on function public\." supabase/migrations/20260701230000_revoke_secdef_fn_grants.sql`
Expected: `49` (the §2 grants; the `^` anchor excludes the commented rollback block).

- [ ] **Step 3: Commit (do NOT push yet — push happens after prod verification in Task 5)**

```bash
git add supabase/migrations/20260701230000_revoke_secdef_fn_grants.sql
git commit -m "fix(security): revoke anon execute on 107 secdef functions + default-privileges hardening"
```

---

### Task 2: Pre-apply guard — assert live state matches the embedded classification

**Tools:** Supabase MCP `execute_sql` only (project_id `xujlrclyzxrvxszepquy`). Read-only.

- [ ] **Step 1: Re-enumerate the regressed set**

```sql
select count(*) as total,
       count(*) filter (where p.prorettype = 'trigger'::regtype) as trigger_fns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```
Expected: `total = 107`, `trigger_fns = 46`. **If total ≠ 107**: list the delta with the query below, classify each new function (UI-called? → add a §2 grant; else nothing) and update BOTH the migration §2 and the rollback list before proceeding. Report the delta to the orchestrator instead of silently adapting.

```sql
select p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
```

- [ ] **Step 2: Assert the deliberate earlier fixes are outside the predicate**

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('enqueue_lead_email','mark_overdue_payments','ensure_recurring_payments','global_search','apply_lead_shuffle')
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```
Expected: `0` (they will not be touched by the loop).

---

### Task 3: Apply to production + catalog verification

**Tools:** Supabase MCP `apply_migration` then `execute_sql`. **This mutates prod — the plan-approval from the user is the authorization; if any MCP call is blocked by the harness, stop and hand back to the orchestrator (do not fall back to Bash/psql/mgmt-API for DDL).**

- [ ] **Step 1: Apply the migration**

Call `apply_migration` with `project_id: xujlrclyzxrvxszepquy`, `name: revoke_secdef_fn_grants`, and `query` = the exact §1–§3 SQL from Task 1 (executable part only; the rollback comment block may be included — it is inert).

- [ ] **Step 2: Verify the surface is closed**

```sql
select count(*) as anon_secdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```
Expected: `anon_secdef = 0`.

- [ ] **Step 3: Verify the 49 keep `authenticated` and the 58 lost it**

```sql
select
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as auth_yes,
  count(*) filter (where not has_function_privilege('authenticated', p.oid, 'EXECUTE')) as auth_no,
  count(*) filter (where not has_function_privilege('service_role', p.oid, 'EXECUTE')) as svc_missing
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef
  and p.oid::regprocedure::text in (
    'accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text)','accounting_mark_paid_in_full(uuid)','assignable_owners()','block_client(uuid,text)','block_job(uuid,text)','bulk_merge_intake(integer)','bulk_merge_intake_preview()','bulk_release_intake(integer)','bulk_release_intake_preview()','close_deal(uuid,jsonb)','complete_accounting(uuid)','convert_lead_to_client(uuid)','create_announcement(text,text,text,boolean,uuid[],timestamp with time zone)','create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text,jsonb,boolean)','current_user_can(text,text)','current_user_in_group(text)','current_user_is_admin()','current_user_scope(text,text)','delete_announcement(uuid)','delete_jobs(uuid[])','delete_leads(uuid[])','discard_lead_intake(uuid)','dismiss_announcement(uuid)','email_failure_rows()','email_outbox_cancel(uuid)','email_outbox_retry(uuid)','email_pipeline_health()','email_queue_rows()','end_job(uuid)','ensure_job_monthly_task_period(uuid)','find_contact_by_phone(text)','find_lead_duplicates(text,text)','get_my_announcements()','import_leads_to_intake(jsonb)','is_task_party(uuid,uuid)','job_billing_ref_count(uuid)','lead_cold_ids(uuid[])','lead_dead_end_ids(uuid[])','lock_deal(uuid)','mentionable_users()','merge_lead_intake(uuid,uuid)','my_google_status()','reengage_lead_intake(uuid,uuid)','release_lead_intake(uuid,boolean)','set_announcement_active(uuid,boolean)','set_job_monthly_task(uuid,text,boolean)','unblock_client(uuid)','unblock_job(uuid)','update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text,jsonb)'
  );
```
Expected: `auth_yes = 49`, `auth_no = 0`, `svc_missing = 0`.

```sql
select p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and p.proname in ('reconcile_payment_integrity','sales_pool_ids','lead_email_payload','log_activity','deal_payments_seed_after_insert','handle_new_auth_user');
```
Expected: 0 rows (spot check: internal/trigger functions no longer authenticated-executable).

- [ ] **Step 4: Verify default privileges**

```sql
select d.defaclobjtype, d.defaclacl::text
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where pg_get_userbyid(d.defaclrole) = 'postgres' and n.nspname = 'public'
order by 1;
```
Expected: `f` (functions) ACL contains **no** `anon=` entry; `r` (tables) and `S` (sequences) ACLs contain **no** `anon=` entry; `authenticated` and `service_role` entries still present in all three.

- [ ] **Step 5: End-to-end default test — create scratch objects, check, drop**

Run via `execute_sql` (DML-ish DDL on scratch objects; if blocked, use `apply_migration` named `tmp_default_priv_probe` and a second one to drop):
```sql
create function public._tmp_priv_probe() returns int language sql security definer as 'select 1';
create table public._tmp_priv_probe_t(id int);
select has_function_privilege('anon','public._tmp_priv_probe()','execute') as fn_anon,
       has_function_privilege('authenticated','public._tmp_priv_probe()','execute') as fn_auth,
       has_table_privilege('anon','public._tmp_priv_probe_t','select') as tbl_anon;
drop function public._tmp_priv_probe();
drop table public._tmp_priv_probe_t;
```
Expected: `fn_anon = false`, `fn_auth = true`, `tbl_anon = false`.

- [ ] **Step 6: Advisors (best effort)**

Call MCP `get_advisors` (`type: security`). Expected: no NEW errors versus the 06-28 baseline; the anon-function surface findings should be gone or reduced. If the tool is unavailable (harness outage), note it and move on.

---

### Task 4: Live smoke test (admin + sales rep)

**Tools:** Playwright MCP against `https://www.itdevcrm.com`. Credentials are supplied by the orchestrator at dispatch time — **never** write them into docs/commits. Use the standard test admin account and one sales-group account.

Purpose: prove the 49 `authenticated` grants cover everything the UI actually calls, and that trigger-functions still fire for ordinary writes.

- [ ] **Step 1: Admin pass** — login and verify each of the following loads without console/network errors (watch for HTTP 401/403/404 on `/rest/v1/rpc/*` in the network tab):
  1. Dashboard (home widgets).
  2. Global search from top bar (type `000` — expect results; exercises `global_search`, untouched).
  3. Sales kanban (`sales_kanban_counts`, lead cards).
  4. A deal detail page → Jobs tab (exercises `job_billing_ref_count` on delete affordances, jobs queries).
  5. Settings → Email health (`email_queue_rows`, `email_failure_rows`, `email_pipeline_health`).
  6. Settings → Announcements list (`get_my_announcements` fires on shell mount for every page anyway).
  7. `/sales/lead-intake` page loads (release/merge RPC surface — do NOT release anything).
- [ ] **Step 2: Admin write-path probe (fires triggers as `authenticated`)** — on `/tasks`, create a personal task titled `grant-smoke-DELETE-ME` (any importance), confirm it appears (fires `user_tasks` notify triggers + `log_activity`), then delete it. Confirm no errors.
- [ ] **Step 3: Sales-rep pass** — login as the sales user; verify: sales kanban loads own leads; open one lead detail; global search returns; no `/rpc/` 401/403 in network log. Log out.
- [ ] **Step 4: Anon negative probe (catalog-level)** — already proven by Task 3 Step 2 (`anon_secdef = 0`); optionally, from the browser session *before* login, confirm the app login page loads normally (anon role needs nothing from `public`).
- [ ] **Step 5:** If ANY UI action hits a 403/`permission denied for function <fn>`: record the function name, and apply a one-line fix via MCP `apply_migration` (`grant execute on function public.<fn>(<args>) to authenticated;`), append the same line to the repo migration file (before the §3 block, with a dated comment), re-test, and report the miss in the task summary.

---

### Task 5: Docs, checklist, push

**Files:**
- Modify: `docs/tech/overview/conventions.md` (append section)
- Modify: `docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md` (mark item 1 done)

- [ ] **Step 1: Append to `docs/tech/overview/conventions.md`**

```markdown
## Migration grants checklist (since 2026-07-01)

Default privileges for `postgres`-created objects in `public` were hardened on
2026-07-01 (`20260701230000_revoke_secdef_fn_grants.sql`): new functions get **no**
`anon`/`PUBLIC` EXECUTE and new tables/sequences get **no** `anon` grants. `authenticated`
and `service_role` defaults remain open. Every new migration must therefore:

1. **New user-facing RPC** — nothing extra needed for the grant (`authenticated` is default),
   but the function body MUST gate internally (`current_user_is_admin()` / `current_user_can(...)`).
2. **New internal / cron / trigger-helper function** — add
   `revoke execute on function public.<fn>(<args>) from authenticated;`
   (cron runs as `postgres` = owner; triggers check EXECUTE at creation time — neither needs a grant).
3. **New backup / scratch table** — add
   `revoke all on table public.<tbl> from authenticated;` (anon is already closed by default).
4. **RPC called from an edge function / script** — `service_role` default grant covers it; if you
   revoke broadly, re-grant `service_role` explicitly.
```

- [ ] **Step 2: Update the sweep report** — in `docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md`, under "Open bugs / action items", change item 1's `🔴 P1` line to start with `✅ DONE 2026-07-01 —` (keep the original text after it) and add one line: `Fixed by supabase/migrations/20260701230000_revoke_secdef_fn_grants.sql (49 RPCs keep authenticated; 58 internal/trigger fns closed; defaults hardened).`

- [ ] **Step 3: Commit and push directly to main**

```bash
git add docs/tech/overview/conventions.md docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md docs/superpowers/plans/2026-07-01-p1-grant-boundary-remediation.md
git commit -m "docs(security): grant-boundary remediation applied — migration checklist + sweep item closed"
git push origin main
```
Expected: push succeeds (no PR — project convention).

---

### Task 3b (ADDENDUM, discovered during Task 3 verification): fix §3 — global PUBLIC revoke

The Task 3 Step 5 probe FAILED on `fn_anon` (got `true`): **per-schema `ALTER DEFAULT PRIVILEGES … IN SCHEMA … REVOKE` entries are additive to the built-in defaults and cannot cancel the hard-wired `PUBLIC=EXECUTE` on new functions** (Postgres semantics). New functions created by `postgres` still got `=X/postgres` (PUBLIC) in their ACL, which `anon` inherits. Tables/sequences were unaffected (their built-in defaults grant nothing to PUBLIC; the anon grants came from the per-schema entry itself, which the §3 revoke correctly removed — `tbl_anon=false` passed).

**Fix:** a GLOBAL (no `IN SCHEMA`) default-privileges entry, which *does* replace the built-in default:

- [ ] **Step 1** — Create `supabase/migrations/20260701231000_default_privs_global_public_revoke.sql`:

```sql
-- Fix for 20260701230000 §3: per-schema ALTER DEFAULT PRIVILEGES entries are
-- ADDITIVE to the built-in defaults and cannot cancel the hard-wired
-- PUBLIC=EXECUTE on new functions. A GLOBAL entry replaces the built-in
-- default, so new functions created by postgres get no PUBLIC grant in any
-- schema. (Verified by scratch-probe: fn ACL still contained =X/postgres.)
alter default privileges for role postgres revoke execute on functions from public;
-- ROLLBACK:
--   alter default privileges for role postgres grant execute on functions to public;
```

- [ ] **Step 2** — Apply via MCP `apply_migration` (name `default_privs_global_public_revoke`).
- [ ] **Step 3** — Re-run the Task 3 Step 5 scratch probe. Expected now: `fn_anon = false`, `fn_auth = true`, `tbl_anon = false`.
- [ ] **Step 4** — Prove the `supabase_admin` default-ACL limitation is real and accepted (read-only): `select pg_has_role('postgres','supabase_admin','member');` → expected `false` (postgres cannot alter supabase_admin's defaults; acceptable because migrations/MCP/dashboard create objects as `postgres` — documented in Research base).
- [ ] **Step 5** — Commit the fix migration:

```bash
git add supabase/migrations/20260701231000_default_privs_global_public_revoke.sql
git commit -m "fix(security): global PUBLIC execute revoke — per-schema default-priv revoke cannot cancel built-in grant"
```

---

## Changes / Revert

**Changes:**
- Prod DB: EXECUTE revoked from `PUBLIC/anon/authenticated` on 107 secdef functions (49 re-granted to `authenticated`; all 107 granted to `service_role`); default privileges for `postgres` in `public` closed to `anon` (functions also to `PUBLIC`).
- Repo: `supabase/migrations/20260701230000_revoke_secdef_fn_grants.sql`, conventions checklist, sweep-report status, this plan.

**Revert:** run the ROLLBACK block embedded (commented) at the bottom of `supabase/migrations/20260701230000_revoke_secdef_fn_grants.sql` via MCP `apply_migration`, then `git revert` the two commits.
