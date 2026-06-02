# Resend Automated Email — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending user review of this spec)

## Goal

Add an automated transactional-email capability to ITDevCRM using **Resend**, and wire it to three concrete needs: client-facing **sales-pipeline** emails, internal **new-job / new-task** notifications, and **payment reminders**. All client-facing emails are in **Greek**.

## Architecture (Approach A — all-Supabase + outbox)

A single Deno **`send-email` Supabase Edge Function** is the only code that talks to the Resend API. It reads `RESEND_API_KEY` from a Supabase Edge Function secret, renders a Greek template, calls Resend, and records the result in `email_log`. Two paths feed it:

- **Synchronous** — the one-click sales emails invoke `send-email` directly (via `supabase.functions.invoke`) so the user gets immediate success/failure feedback.
- **Asynchronous** — automated emails are written to an **`email_outbox`** queue (by DB insert-triggers and a daily reminder job). A frequent **drain cron** invokes `send-email` for each pending row, with retry + status, so no automated email is silently lost.

This matches existing patterns: the `invite_user` Edge Function (Deno + service role) and the `pg_cron` job already running `ensure_recurring_payments()`.

```
sales one-click ──► send-email (Edge Fn) ──► Resend ──► email_log
                         ▲
DB triggers (job/task) ──┤
daily reminder job ──────┴──► email_outbox ──► drain cron ──► send-email ──► Resend ──► email_log
```

## Manual setup (only the user can do these — documented in the plan)

1. **Resend account + API key.** Store the key as a Supabase secret — never in the repo:
   `supabase secrets set RESEND_API_KEY=… --project-ref xujlrclyzxrvxszepquy`.
   The key shared during brainstorming was exposed in plaintext chat and **must be rotated before go-live**.
2. **Verify `itdev.gr` on Resend.** Add the DKIM / SPF / DMARC DNS records Resend generates. These must **coexist** with the domain's existing mail (e.g. Google Workspace) — the plan will list each record and note that SPF should be merged (one SPF record only), not duplicated.
3. **Confirm mailboxes** `sales@itdev.gr`, `accounting@itdev.gr`, `noreply@itdev.gr` exist (the first two are real inboxes that receive replies).

## Sender identities (config map inside the Edge Function)

| Identity | From | Reply-To | Used by |
|---|---|---|---|
| `sales` | `ITDev <sales@itdev.gr>` | `sales@itdev.gr` | Offer sent, Won welcome |
| `accounting` | `ITDev Λογιστήριο <accounting@itdev.gr>` | `accounting@itdev.gr` | Payment reminders |
| `internal` | `ITDev <noreply@itdev.gr>` | `noreply@itdev.gr` | New job / new task notices |

## Data model (new tables, in a migration)

**`email_outbox`** — the queue for asynchronous sends:
- `id uuid pk`, `identity text` (`sales`|`accounting`|`internal`), `to_email text not null`,
  `template_key text not null`, `data jsonb not null default '{}'`,
  `dedupe_key text` (nullable), `status text not null default 'pending'` (`pending`|`sent`|`failed`),
  `attempts int not null default 0`, `last_error text`, `created_at timestamptz default now()`, `sent_at timestamptz`.
- Index on `(status, created_at)` for the drain cron.

**`email_log`** — audit + idempotency for every attempted send:
- `id uuid pk`, `identity text`, `to_email text`, `template_key text`, `resend_id text`,
  `status text` (`sent`|`failed`), `dedupe_key text`, `error text`, `created_at timestamptz default now()`.
- **Partial unique index on `dedupe_key` where `dedupe_key is not null` and `status = 'sent'`** — guarantees a given logical email (e.g. "3-day-before reminder for payment X") is sent at most once.

RLS: both tables admin-read only; writes happen via `security definer` functions / the service-role Edge Function. No client writes.

## `send-email` Edge Function contract

Request (POST, authenticated): `{ identity, to, templateKey, data, dedupeKey?, dryRun? }`.
Behaviour:
1. Authorize: callers must be an authenticated admin/staff member (mirror `invite_user`'s caller check) **or** the service role (drain cron).
2. If `dedupeKey` already has a `sent` row in `email_log`, skip and return `{ skipped: true }`.
3. Render the Greek template for `templateKey` with `data` → `{ subject, html, text }`.
4. If `dryRun` (or the global `EMAIL_DRY_RUN` secret is on), write an `email_log` row with `status='sent'`, `resend_id='dry-run'`, and **do not** call Resend.
5. Otherwise POST to Resend with the identity's From/Reply-To; on success log `sent` + `resend_id`, on failure log `failed` + error and return non-200.

## Templates (Greek, server-side module)

`offer_sent`, `won_welcome`, `payment_due_soon`, `payment_due_today`, `payment_overdue`, `internal_new_job`, `internal_new_task`. Each exports `{ subject(data), html(data), text(data) }`. Shared branded header/footer. Required `data` per template documented in the plan (e.g. `payment_*` need client name, service label, amount gross, due date, deal link; `offer_sent` needs offer link/PDF URL; `internal_*` need job/task title + link).

## Flows

### 1. Sales — Offer sent & Won welcome (one-click with preview)
- On the Sales kanban / deal, moving a lead to **Offer Sent** (or marking a deal **Won**) surfaces a **"Send email"** action.
- The action opens a dialog with a **pre-filled, editable Greek draft** (recipient defaults to the client/lead `email`; offer emails include the offer link / generated PDF URL). The user can edit subject/body, then clicks **Send**.
- Send invokes `send-email` directly with identity `sales`; the dialog shows success/failure. A `dedupe_key` like `offer:<lead_id>` / `won:<deal_id>` prevents accidental double-send but the UI allows an explicit "send again".
- No automatic send on stage change — the action is always user-initiated.

### 2. Internal — new job / new task (automatic)
- **New task:** `AFTER INSERT` trigger on `assigned_tasks` enqueues an `internal` outbox row to the **assignee's** `profiles.email`, **suppressed when `assignee_user_id = created_by_user_id`** (mirrors the existing in-app `assigned_tasks_notify_assignee` logic). `dedupe_key = 'task:'||new.id`.
- **New job:** `AFTER INSERT` trigger on `jobs` enqueues one `internal` outbox row **per active member of `assigned_group_id`** (join `group_members` → `profiles.email`). `dedupe_key = 'job:'||new.id||':'||user_id`.
- These complement (do not replace) the in-app notifications.

### 3. Payment reminders (automatic, cron)
- A `security definer` SQL function **`enqueue_payment_reminders()`** scans `deal_payments` joined to `deals`→`clients` for **pending** (`status='pending'`) rows on non-archived deals and enqueues an `accounting` outbox row to the client `email` when the due date (`start_date`) is:
  - **3 days out** → `payment_due_soon` (lead time configurable via a constant), `dedupe_key='pay_soon:'||payment_id`;
  - **today** → `payment_due_today`, `dedupe_key='pay_today:'||payment_id`;
  - **1 day past and still pending** → `payment_overdue` (single notice, no escalation), `dedupe_key='pay_overdue:'||payment_id`.
- Rows whose `dedupe_key` already has a `sent` `email_log` entry are skipped (idempotent across daily runs).
- Scheduled via `pg_cron` daily (e.g. 08:00 Europe/Athens), alongside the existing recurring-payments job.

### Drain cron
- A `pg_cron` job every ~2 minutes (or a Supabase scheduled function) selects `email_outbox` rows where `status='pending' and attempts < N`, invokes `send-email` per row (service-role auth) with the row's `dedupeKey`, and marks `sent`/`failed` (incrementing `attempts`, recording `last_error`). Failed rows retry until the attempt cap, then stay `failed` for admin visibility.

## Idempotency & safety
- All automated emails carry a `dedupe_key`; the `email_log` unique index makes re-sends impossible even if a trigger or cron double-fires.
- **`EMAIL_DRY_RUN`** secret lets us run the entire pipeline (triggers → outbox → drain → log) without delivering to real clients, for verification before go-live.

## Testing
- **Unit (vitest):** template rendering — each template returns non-empty Greek subject/html/text for representative `data`.
- **SQL test (`supabase/tests/`):** `enqueue_payment_reminders()` selects exactly the right payments for the 3-day / today / overdue windows and respects dedupe — following the existing `ensure_recurring_expenses.sql` test style.
- **Edge Function:** exercised against Resend's sandbox and in `dryRun` mode.
- **Frontend:** the one-click send dialog renders the draft and calls `send-email` (mocked) — RTL test like the existing dialog tests.

## Out of scope (future specs)
Inbound/reply parsing, marketing/bulk campaigns, open/click tracking, per-client unsubscribe/preferences, multi-language templates (Greek only for now).

## Changes / Revert
- **New:** migration adding `email_outbox` + `email_log` (+ RLS, indexes); `enqueue_payment_reminders()` + its cron; drain cron; `AFTER INSERT` triggers on `assigned_tasks` and `jobs`; the `send-email` Edge Function + Greek templates; the sales one-click send dialog; i18n strings; the `resend` dependency is **not** added to the app bundle (the Edge Function calls Resend's REST API directly from Deno).
- **Secrets:** `RESEND_API_KEY` (+ optional `EMAIL_DRY_RUN`) as Supabase Edge Function secrets — never in the repo.
- **Revert:** each migration ships with a `-- ROLLBACK:` block (drop triggers, crons, functions, tables); the Edge Function can be deleted with `supabase functions delete send-email`; frontend changes are additive (one dialog + an action button) and revert by commit. Disabling sending without a full revert = set `EMAIL_DRY_RUN` on, or `cron.unschedule` the reminder + drain jobs.

## Assumptions (confirmed during brainstorming)
- Internal sender identity = `noreply@itdev.gr`; recipients = task assignee / job group members.
- Reminder lead time = 3 days (configurable); overdue = single notice, no repeating escalation.
- All emails Greek.
- New-lead acknowledgement email is **not** included (only Offer sent + Won welcome on the client side).
