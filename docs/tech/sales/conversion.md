# Lead → Deal Conversion

**Purpose** — Converting a Won sales lead creates a `clients` row + a `deals` row (handed to Accounting onboarding) and links the lead back to the deal via `converted_deal_id`. On the deal side, `lock_deal` is the parallel gate that finalises a deal and sends it to Accounting.

## Data model

### `leads` (conversion columns)
| Column | Notes |
| --- | --- |
| `converted_at` timestamptz | set when conversion succeeds (non-null ⇒ converted; excluded from the board) |
| `converted_client_id` uuid → `clients` | the created client |
| `converted_deal_id` uuid → `deals` | **the link from Won lead to its deal** |
| `won_by_user_id` uuid | the converting user |
| `code` text | carried onto both the client and the deal (shared code) |
| `payment_method`, `estimated_one_time_value`, `estimated_monthly_value`, `services_planned`, `company_name`, `email`, `phone`/`address` | conversion preconditions |

### `deals` (created by conversion)
- `client_id`, `code` (= lead code), `stage_id` (sales `won`), `accounting_stage_id` (accounting `new`), `locked_at`/`locked_by` (set to now/uid at creation), `actual_close_date`, `won_by_user_id`, `payment_method`, `one_time_value`, `recurring_monthly_value`, `services_planned`.

### `clients` (created by conversion)
- `name` = lead `company_name`, contact fields, `code` (= lead code), `start_date = current_date`.

### `pipeline_stages`
- Sales `won` (terminal, `triggers_action = 'lock_deal'`).
- Accounting `accounting_onboarding` → `new` (the deal's landing column).

## Flow

```mermaid
flowchart TD
  drag[Lead dragged to Won\n(or convert action)] --> rpc[convert_lead_to_client]
  rpc --> perm{admin or sales/lock_deal?}
  perm -->|no| denied[permission_denied]
  perm -->|yes| valid{validate lead}
  valid -->|fail| errs[value / service / email /\nphone-or-address / company /\npayment_method required]
  valid -->|already converted/archived| stop[reject]
  valid -->|ok| createC[(INSERT clients\ncode = lead.code)]
  createC --> createD[(INSERT deals\nstage=won, accounting_stage=new\nlocked_at=now, code=lead.code)]
  createD --> reparent[move comments + attachments\nlead → deal]
  reparent --> updL[UPDATE lead\nconverted_at/client_id/deal_id\nstage=won, won_by_user_id]
  updL --> notify[notify lead owner: lead_converted]
  updL --> emails[leads_email_automations:\nwon_welcome + won_next_steps]
  createD --> acct[Deal appears in Accounting\nonboarding 'new']

  lockDealAction[Deal: Lock action] --> ld[lock_deal RPC]
  ld --> ldValid{client + value + ≥1 job\n+ contract attachment}
  ldValid -->|ok| ldSet[set locked_at, stage=won]
```

## Functions / triggers / crons

- **`convert_lead_to_client(target_lead_id)`** (security definer) — the lead→deal path. Requires `admin` or `sales/lock_deal`. Validates the lead: combined estimated value > 0, ≥1 `services_planned`, non-empty `email`, `phone` OR `address`, non-empty `company_name`, and **`payment_method` set** (added in `20260504000002` so Accounting never inherits a methodless deal). On success: INSERTs `clients` (sharing the lead `code`, `start_date = today`), INSERTs `deals` (sales stage `won`, `accounting_stage_id` = onboarding `new`, `locked_at = now()`, `locked_by`/`won_by_user_id = auth.uid()`, copies values/services/payment method), **re-parents** the lead's `comments` and `attachments` to the new deal, then UPDATEs the lead (`converted_at`, `converted_client_id`, `converted_deal_id`, `stage_id = won`, `won_by_user_id`). Notifies the lead owner (`lead_converted`). Returns `{ok, lead_id, client_id, deal_id, code}`.
- **`lock_deal(target_deal_id)`** (security definer) — the deal-side gate (for deals built directly in Accounting / not from a lead). Requires `admin` or `sales/lock_deal`. Validates: client exists with email + (phone OR address), combined value > 0, **≥1 non-archived job**, and **≥1 `contract` attachment**. On success sets `locked_at`/`locked_by`, `actual_close_date`, moves the deal's sales `stage_id` to `won`, and notifies the deal owner (`lock_deal`).
- **`leads_email_automations()`** — on the lead reaching `won`, enqueues `won_welcome` + `won_next_steps` (gated by the email-automation toggles). See kanban doc.
- **`current_user_can('sales','lock_deal')`** — the capability both conversion and lock check (alongside admin).

No crons (but see the sales-app push below — it has one as a backstop).

## Sales-app push (2026-08-24)

Every conversion also auto-records the win as a sale in the sales app
(sales.itdevcrm.com, Supabase `cthjxcftxwxbjpqmfiko`) — salespeople no longer
enter closed CRM deals manually on /tracking there:

- `leads_won_push_enqueue` (AFTER UPDATE on `leads`, fires only on the
  `converted_at` null→set transition, so old-CRM backfill INSERTs never fire)
  queues into `won_push_outbox`; a statement-level pulse (`won_push_pulse`,
  best-effort `net.http_post`) plus a `*/10min` cron `won_push_drain` call the
  `push-won-sale` edge function.
- The function maps: package label = `services_planned` package names
  (`service_packages.display_names.el`), `packages_sold` = service count,
  `amount` = one_time + monthly **as stored** — deal values are NET of VAT
  (the current `seed_deal_payments` treats them as `amount_net` and adds VAT
  on top), so no VAT math is applied. Commission 23% flat (parity with the
  manual form), credit = lead owner (fallback won_by), matched to the sales
  app by profile email. (2026-08-24: an earlier version divided by 1.24 per
  the June-era gross convention — corrected same day, rows re-pushed.)
- Idempotent end-to-end: upsert on `sales.crm_deal_id` (partial unique index
  there). A failed push never affects the win — the outbox row keeps the error
  and the cron retries (max 8 attempts).
- Secrets: vault `won_push_secret` + edge `WON_PUSH_SECRET`,
  `SALES_SUPABASE_URL`, `SALES_SERVICE_ROLE_KEY`.
- Migrations: `20260824150000_won_deal_push.sql` (CRM),
  `20260824130000_crm_won_sales.sql` (sales app).

## Gotchas

- The lead's drag-to-Won on the kanban calls **`convert_lead_to_client`**, not a plain stage move — the move and the client/deal creation are one RPC. A failed validation leaves the lead where it was.
- **`converted_deal_id` is the Won-lead → deal link.** It (and `converted_at`/`converted_client_id`) are what mark a lead converted; converted leads are excluded from active board/index partial indexes.
- The deal created by conversion is **already `locked_at = now()`** and pre-placed in Accounting `new` — there is no separate lock step for lead-originated deals. `lock_deal` is for deals created another way (e.g. accounting-created deals), which require the contract attachment + ≥1 job.
- `convert_lead_to_client` requires **`payment_method`** on the lead; `lock_deal` does **not** re-check it (the deal already carries it). Different precondition sets — conversion checks the lead's fields, `lock_deal` checks the client + jobs + contract.
- The lead `code` is shared verbatically across lead → client → deal, so cross-references stay consistent. Off-board "Won leads backfill" (migrated old-CRM deals) creates Won leads linked via `converted_deal_id` without re-running accounting inserts — do not assume every `converted_deal_id` came through this RPC.
- Comments and attachments are **moved** (re-parented) lead → deal, not copied; after conversion the lead has none.

## File references

- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260504000002_convert_lead_require_payment_method.sql` — current `convert_lead_to_client` body (with payment-method gate)
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260502000018_convert_lead_rpc.sql` — original conversion RPC
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260502000010_lock_deal_rpc.sql` — `lock_deal`
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260502000017_leads_table.sql` — `leads` conversion columns + RLS
- `/Users/marios/Desktop/Cursor/itdevcrm/supabase/migrations/20260502000002_pipeline_stages.sql` — sales `won` + accounting `new` stages
- `/Users/marios/Desktop/Cursor/itdevcrm/src/features/leads/hooks/useConvertLead.ts` — convert mutation
- `/Users/marios/Desktop/Cursor/itdevcrm/src/features/sales/SalesKanbanPage.tsx` — drag-to-Won → convert
