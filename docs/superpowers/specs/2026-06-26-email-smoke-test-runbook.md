# Email Automation — Full Lifecycle Smoke Test (Runbook)

**Date:** 2026-06-26
**Mode:** Live, production, admin UI (info@itdev.gr). Organic only — the system fires
its own triggers; no trigger/RPC is invoked manually to simulate. The database is
touched ONLY to (a) read `email_log` for verification and (b) delete at teardown.
**Recipient for every email:** `mkifokeris@itdev.gr` (set on the lead at import →
copied to `clients.email` on conversion).

## Emails verified live (on-transition / immediate)

| # | Organic admin action | Email | From | Dept gate |
|---|---|---|---|---|
| 1 | Lead Intake → import 1 CSV row (email=mkifokeris@…) → **Release** → `unique_lead` | `lead_welcome` | sales@ | dept_sales |
| 2 | Move lead → `no_answer` | `noanswer_day0` | sales@ | dept_sales |
| 3 | Edit lead → set **Scheduled for** (→ `scheduled`) | `scheduled_confirm` | sales@ | dept_sales |
| 4 | Move lead → **Won** (auto-convert → client + deal) | `won_welcome` + `won_next_steps` | accounting@ / sales@ | dept_accounting / dept_sales |
| 5 | Deal: add **web_seo** + **local_seo** services → jobs spawn into `new_project` | `webseo_gsc_access` + `localseo_gbp_access` | accounting@ | dept_technical |

Also pass through `working_on_it`, `offer_sent`, `hot` for completeness (cron-only
cadences there — nothing immediate).

## NOT testable in one session (date/cron-driven — note only)

`payment_due_soon/today/overdue`, multi-day `noanswer_day2/5/10`, `offer_followup_*`,
`scheduled_reminder/noshow`, `reengage_90d`. They fire from the daily 06:00 UTC cron
against specific dates; a stage-walk cannot trigger them.

## Pre-flight (read-only)

1. `/admin/email-automations` → confirm `dept_sales`, `dept_accounting`,
   `dept_technical` are ON.
2. Snapshot `email_log` rows for `mkifokeris@itdev.gr` (baseline).
3. ⚠️ `won_welcome` is deduped once-per-recipient-email. If mkifokeris already
   received one historically, it will not resend (expected; surface it).

## Verification (no DB writes)

After each step: entity page → **Activity feed → filter "Emails"** (renders
sent/delivered/bounced) AND a read-only `email_log` query by `to_email` /
`template_key` / `created_at`.

## Lifecycle entry mechanics (why this path)

- Admin (info@itdev.gr) is blocked by `leads_enforce_stage_restriction` from moving a
  lead INTO `unique_lead`. The legitimate admin path is Lead Intake → **Release**
  (`release_lead_intake`, admin-gated, GUC bypass) → lands in `unique_lead` → fires
  `lead_welcome`. Moving OUT of `unique_lead` is unrestricted.
- Moving a lead to **Won** calls `convert_lead_to_client` (`LeadDetailPage.tsx:147`),
  creating: a `clients` row (email inherited), a `deals` row in accounting `new`
  stage, and a `source='import'` dedup lead linked via `converted_deal_id`.
- Jobs spawn from `deals.services_planned` into each board's first stage
  (`new_project`, position 10) on the Paid-In-Full / complete-accounting path. Entry
  into `new_project` fires the SEO onboarding email (deduped per deal per service).

## Teardown (end only — FK-safe delete order)

Capture IDs first: released `lead_id`, dedup `lead_id` (via `converted_deal_id`),
`client_id`, `deal_id`, `job_ids[]`. Then delete in order:

1. `email_log` (by client_id + to_email + the run's created_at window)
2. `email_outbox` (test dedupe_keys)
3. `activity_log` (entity_type/entity_id for lead/client/deal/jobs)
4. `offers` (lead_id/deal_id/client_id)
5. `comments`, `attachments` (polymorphic by parent_type+parent_id for deal/job/client)
6. `assigned_tasks`, `user_tasks` (deal/job/client)
7. `deal_payment_lines`, `monthly_invoice_items` (by job_ids)
8. `jobs` (by deal_id)
9. `deal_payments` (by deal_id)
10. `deals` (by id)
11. `monthly_invoices`, `client_blocks`, `contracts` (by client_id)
12. `clients` (by id)
13. `leads` (released + dedup ids)
14. `lead_intake` (released_lead_id row)

(Most child FKs are CASCADE off deals/clients; the explicit deletes above cover the
polymorphic/log tables that do NOT cascade. Teardown runs via Supabase MCP
`execute_sql`, scoped to captured IDs only.)

## Constraints honored

- Organic: I only drive the UI; the system's triggers fire the emails. No manual
  trigger/RPC simulation.
- DB writes only at teardown; DB reads only for verification.
- Known caveats surfaced, not silently worked around (won_welcome dedup; live
  confirmation of the deal's add-service/create-job control).
