# Jobs as the Billing Unit — Unified Jobs + Payments Design

**Status:** Approved (design) — 2026-06-17. Implementation pending; nothing committed until the working result is approved on localhost.

## 1. Problem

Today three things are derived **separately** from `deals.services_planned`:

```
services_planned ──┬──► deal_payments  (money schedule)
                   └──► jobs           (work on the boards)
```

`jobs` and `deal_payments` are never linked. Jobs have no title/description/editable price, and accounting has **no way to create a job**. So renewals, extra work, and one-off charges force accounting to edit a *sales* field and re-trigger spawning, and money/work drift apart. This is the "I must create new jobs and keep them updated" pain.

## 2. Goal

Make a **job the single, self-contained unit of work + billing** that accounting can create and manage directly, with payments generated *from* jobs. One model, one screen, minimal accounting effort.

Concrete requirements (from the user):
- Jobs carry their own billing (price + one-time/recurring cadence).
- Payments per job can be billed **together or separately**.
- Accounting can create **custom jobs**: title, price, description, department, one-time or recurring.
- Custom items **stay as jobs** and remain associated with the deal page.
- Accounting manages it all quickly.

## 3. Data model changes

### 3.1 `jobs` (additive columns)
| Column | Type | Meaning |
|---|---|---|
| `title` | text | Free label. Standard jobs default to the service label; editable. |
| `description` | text null | Optional. |
| `is_custom` | boolean default false | Manually created by accounting vs spawned from a sale. |
| `amount_net` | numeric(12,2) | The main net charge (per period for recurring; total for one-time). Backfilled from `monthly_amount`/`one_time_amount`. |
| `vat_rate` | numeric(5,2) default 24 | VAT %, defaulted by client country (Cyprus 0, else 24). |
| `billing_active` | boolean default true | When false, recurring generation stops (job "ended"). |
| `billing_only` | boolean default false | True = no kanban board (Billing-only department). |

`billing_type` (`one_time`/`recurring_monthly`/`recurring_yearly`), `setup_fee`, `service_type`, `stage_id`, `owner_user_id`, `assigned_group_id`, `status`, `code`, `details` stay as-is. `monthly_amount`/`one_time_amount` are kept for back-compat during cutover, then deprecated (read `amount_net`).

**Department / Billing-only:** `service_type` keeps routing to a board. A new "Billing-only" department is represented by `billing_only = true` (its job gets `stage_id = null`, no board). The existing 7 service types remain the board departments.

### 3.2 `deal_payments` → invoice header, with lines
- `deal_payments` becomes the **invoice header**: `id, deal_id, due_date (= end of period / charge date), status, invoice_number, paid_at, created/updated`. Existing money columns stay valid; header totals are the sum of its lines (kept via a generated/maintained value or computed in views).
- **New `deal_payment_lines`** table = the items:

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid PK | |
| `payment_id` | uuid → deal_payments(id) cascade | Parent invoice header. |
| `job_id` | uuid → jobs(id) | The job this line bills. |
| `label` | text | e.g. "Web SEO — June", "Setup fee", "Installment 1/2". |
| `amount_net` | numeric(12,2) | Net for this line. |
| `vat_rate` | numeric(5,2) | VAT % for this line. |
| `vat_amount` / `amount_gross` | generated | `round(net*rate/100,2)` / `round(net+net*rate/100,2)`. |

- **Separate billing** = one line per payment (default). **Together** = several jobs' lines on one payment header (one due date, one total, one invoice #, one "mark paid").
- Header `amount_net/vat_amount/amount_gross` are exposed via a view (`deal_payments_with_totals`) summing the lines, so existing readers (kanban card, recurring page, ledger) keep working with minimal change.

> Back-compat: existing single-job `deal_payments` rows are migrated to header + one line each (line `job_id` resolved by matching `service_type`/`service_index` to the deal's jobs).

### 3.3 Billing groups (how "together" is set)
`jobs.billing_group_id uuid null`. Recurring generation groups a deal's active recurring jobs by `(billing_group_id, period)` → one combined payment header with one line per job. Jobs with `billing_group_id = null` bill on their own. Accounting sets/clears the group from the Jobs & Billing panel ("Bill together" / "Bill separately").

## 4. RPCs (accounting self-serve, SECURITY DEFINER — mirrors `block_job`)
- `create_custom_job(deal_id, title, description, department, billing_type, amount_net, vat_rate, setup_fee, billing_only)` → inserts a job (`is_custom=true`, `status='active'`, owner = team lead if department has a board), generates its first payment(s), returns `{ok, job_id}`.
- `update_job_billing(job_id, {title, description, amount_net, vat_rate, billing_type, billing_group_id})` → updates the job; future payments follow (does not rewrite already-issued/paid payments).
- `end_job(job_id)` → `billing_active=false` (recurring stops); optionally archive.
- All gated `is_admin OR current_user_can('accounting_onboarding','edit')`. Granted to `authenticated`.

## 5. Generation logic (job-driven)
- **Initial spawn:** `convert_lead_to_client` (and the existing spawn path) creates **jobs** from `services_planned`, each carrying `amount_net`/`vat_rate`/`billing_type`/`setup_fee`. Then `generate_payments_for_deal(deal_id)` creates payment headers + lines from the jobs:
  - one-time job → one header/line (web_dev `payment_terms` 50/50 or 50/25/25 → N installment headers/lines; setup_fee → its own one-time line).
  - recurring job → first period header/line (`end_date = +1 month/+1 year`).
  - jobs sharing a `billing_group_id` and cadence → combined header with multiple lines.
- **Recurring renewal:** `ensure_recurring_payments` rewritten to iterate **active recurring jobs** (`billing_active = true`, deal not archived) and, per billing group, create the next period's header/lines when within 7 days of period end and no successor exists. `billing_active=false` ⇒ no renewal (this replaces "recreate the job").
- VAT, net-basis, overdue marking, auto-move-to-awaiting, reminders, ledger/P&L: continue to operate on payment headers (via the totals view) — minimal change.

## 6. Accounting UI — "Jobs & Billing" panel (deal page)
Replaces the separate Payment + Jobs tabs for the accounting view with one panel listing every job (sold + custom):
- Per job row: title, department, price + cadence, next payment date, status; inline **edit price/cadence**, **End** button, **Bill together/separately** grouping control.
- **"+ Add job"** → form: title, department (incl. Billing-only), price (net) + VAT, cadence, optional description + setup fee.
- Payments shown per job / per combined group with **mark paid** + **invoice number** inline (reuses current PaymentRow behavior, now line-aware).

## 7. Permissions
- Board RLS unchanged (`jobs_mutate_admin_or_service`).
- Accounting job create/edit/end via the SECURITY DEFINER RPCs above (so accounting needs no direct table-mutate).
- `deal_payment_lines` RLS mirrors `deal_payments` (SELECT: admin / sales/clients/accounting view; write: admin / accounting_onboarding edit).

## 8. Migration sequence (additive, no downtime; each its own migration + rollback SQL)
1. Add `jobs` billing columns + `deal_payment_lines` table + `deal_payments_with_totals` view + `billing_group_id`.
2. Backfill: jobs `title`/`amount_net` from current amounts + country VAT; convert each existing `deal_payments` row → header + one line (resolve `job_id`); create jobs for any orphan payments.
3. Add the RPCs (`create_custom_job`, `update_job_billing`, `end_job`) + `generate_payments_for_deal`.
4. Swap `ensure_recurring_payments` to job-driven (keep old as `_legacy` until verified).
5. Point spawn (`convert_lead_to_client` / `release_jobs_for_deal`) at job-driven generation; keep `services_planned` as the sales record only.

## 9. Testing
- **pgTAP:** job-driven seeding (one-time, recurring, installments, setup fee); renewal per active job; `billing_active=false` stops renewal; combined vs separate generation; `create_custom_job`/`update_job_billing`/`end_job` permission + effect; VAT/net basis; backfill parity (new totals == old `amount_gross`).
- **Frontend (Vitest/RTL):** Jobs & Billing panel render, add-custom-job form, edit price, end job, group/ungroup, mark paid; totals view mapping.
- **Manual on localhost:** create a custom recurring job → see it on the board + deal + generating payments; group two jobs → one combined invoice; end a job → renewal stops.

## 10. Changes / Revert
- All schema changes are additive with inline rollback SQL; old columns (`monthly_amount`/`one_time_amount`) retained through cutover for instant fallback.
- `ensure_recurring_payments` kept as `_legacy` until the job-driven version is verified, so renewal can be reverted by re-pointing the cron.
- Atomic commits per task; nothing committed/pushed until the working result is approved on localhost.

## 11. Open execution question (to resolve before the demo)
The localhost demo needs the schema live somewhere the app can read. Options: **(a)** local Supabase via Docker (true isolation, needs Docker running), or **(b)** apply to the linked `CRM` project DB. To be confirmed before running migrations.
