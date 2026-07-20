# Multiple web_dev jobs per deal — design

Date: 2026-07-20
Status: implemented 2026-07-20 (commits ebaf34f, b7414e6, 94f77a8, d2d52e7 + fix wave 4c63503, 21795af; prod smoke passed on deal 006095)

## Goal

A deal can hold any number of `web_dev` jobs — one job per website, matching the existing "web_dev job = a website" model. Extra websites are added manually, on demand, from the deal page. Billing is untouched: the new job carries no payments; accounting attaches billing later through the existing per-job billing tools if needed.

## Owner decisions (2026-07-20)

- **Creation flow:** manual "Add website" button on the deal page (confirmed).
- **Billing:** no automatic billing on add (confirmed).
- **Access:** admins + accounting can add (confirmed).
- **Job codes:** first job keeps `<dealcode>-WEBDEV`; added websites get `-WEBDEV-2`, `-WEBDEV-3` (assumed — owner AFK; this is what `generate_job_code` already does automatically).
- **Approach:** dedicated lightweight Add-website dialog, not the billing-oriented Add-service form (assumed — owner AFK).

## What already works — no changes needed

- **Job codes**: `generate_job_code` auto-suffixes `-2`, `-3` and `jobs_code_unique` guarantees uniqueness (`20260618130000_job_unique_codes.sql`).
- **Client intake wizard**: `job_intake_forms.job_id` is the primary key — each website gets its own `/f/<token>` link from its own job page (`20260714150000_webdev_client_intake.sql`).
- **Info tab / kanban / deal Jobs tab**: all render per job; a second web_dev card just appears.
- **Recurring billing**: web_dev is `one_time` so `ensure_recurring_payments` never touches it — no double-billing risk.
- **Manual billing attach**: `update_job_billing` / `generate_payments_for_deal` link payments by explicit `job_id` via `deal_payment_lines` — already multi-web_dev-safe.
- **Cleanup**: a mistakenly added website is removable via the existing `delete_jobs` admin RPC.

## Changes

### 1. New RPC `add_web_dev_job(p_deal_id, p_website, p_industry default null)`

- Security definer with an internal role check (admin, accounting), `execute` granted to `authenticated` only — per grant-boundary conventions.
- Creates one `jobs` row: `service_type='web_dev'`, `billing_type='one_time'`, `installment_plan='custom'`, no payments generated, `details.website` / `details.industry` from the arguments.
- Deliberately does **not** include the `web_dev_job_exists` guardrail — this is the sanctioned path for additional websites.
- Trigger interplay: `jobs_seed_web_dev_info` (BEFORE INSERT) is fill-empty-only by design (`20260715130000_web_dev_info_seed.sql:9`), so the explicitly entered URL wins and no trigger change is needed. If Industry is left blank in the dialog, the trigger fills it from the client — desirable, same client. (Re-verify the live def via `pg_get_functiondef` at implementation time, per standard prod-drift practice.)
- Returns the new job id + code.

### 2. Frontend "Add website" action

- Button on the deal detail page near the services/jobs area, visible to admin + accounting only.
- Small dialog: **Website URL** (required) + **Industry** (optional dropdown, reusing the options from the web_dev Website+Industry Info work).
- On success: invalidate the deal's jobs queries; the job appears on the deal Jobs tab and the Web Dev board at its default entry stage (same stage logic as `create_custom_job`).

### 3. Department-task routing fix

- `src/features/assigned_tasks/hooks/useDealServiceJob.ts` currently does `.order('created_at').limit(1).maybeSingle()` — with two web_dev jobs it silently picks the oldest. Change it to return **all** matching jobs so a dept-tagged deal task surfaces on every web_dev job of the deal (read-side only, per the existing dept-task-on-job design).
- Notification deep-links keep their current single-job resolution — acceptable.

## Non-goals

- **Comment threads stay shared**: all web_dev jobs on a deal continue to share the deal-level Dev channel (`deal_dev`), per the 2026-07-09 comment-channels design.
- **Automated seeder untouched**: won deals still seed at most one web_dev job; extra websites are always manual. The `seed_deal_jobs_and_payments` oldest-job payment-line binding stays as-is.
- **Existing guardrail kept**: `create_custom_job` keeps its `web_dev_job_exists` warning (with force-confirm) so the billing-oriented Add-service path retains its friction.
- **No billing automation** for added websites.

## Error handling

- RPC validates: deal exists, caller has admin/accounting role, website non-empty; returns structured `{ok:false, errors:[...]}` like `create_custom_job`.
- Code-generation race: the unique index rejects; surface the error (retry is manual and near-impossible to hit).

## Testing

- SQL via the Management-API harness (jwt-claims trick): as accounting, add a website to a deal that already has `000xxx-WEBDEV` → new job `-WEBDEV-2` with the entered website/industry in `details`; add again → `-WEBDEV-3`; as a sales rep → rejected; website empty → rejected; verify no `deal_payments` rows were created.
- Frontend smoke with the standing test accounts. Caution: vitest runs against PROD.

## Changes / Revert

- **Migration** (RPC + possible `jobs_seed_web_dev_info` tweak): revert = `drop function public.add_web_dev_job(uuid, text, text);` and restore the prior trigger function body (captured live before editing).
- **Frontend**: revert the commits.
- **Data**: any added jobs are removable via the `delete_jobs` RPC.
