# Client Activity Feed — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Owner:** Marios

## Goal

On a client's detail page, the **Activity** tab must show *every* action that happens
for that client, merged into one chronological feed:

- **Payments** — new, marked paid, set pending, amount changed, deleted (across all the client's deals).
- **Emails** — which template/trigger fired, whether it was sent, and the delivery outcome (delivered / bounced / complained).
- **Jobs** — created, status change (active/completed/done), stage moves, blocked/unblocked, deleted.
- **Deals** — stage moves, won, value changes, on-hold / paid-in-full transitions, archived.
- **Attachments** — file uploaded / deleted on the client, its deals, or its jobs.
- **Tasks** — created / completed, linked to the client.

Comments are intentionally **out of scope** for now.

## Current state (what exists today)

- `activity_log` is a generic event store: `entity_type, entity_id, user_id, action ('insert'|'update'|'delete'), changes jsonb, created_at`.
- A reusable trigger fn `log_activity()` writes rows. Triggers already exist on **clients, deals, jobs, attachments** (and comments).
- **No** activity logging on `deal_payments`, `user_tasks`, `assigned_tasks`, `email_log`.
- Activity rows are keyed **by entity, with no `client_id`** — so "everything for a client" requires resolving each row back to a client.
- The client Activity tab today renders `ActivityPanel entityType="clients" entityId={id}` — i.e. **only changes to the client row itself**.
- `email_log` columns: `id, identity, to_email, template_key, resend_id, status, dedupe_key, error, created_at`. No client link; `status` is only `sent`/`failed`/`skipped` captured at send time. No delivery tracking; no Resend webhook consumer exists.
- `send-email` edge fn captures the Resend message id into `email_log.resend_id`. Callers pass a `data` payload (sometimes containing `deal_id` / `code`), never an explicit `client_id`.
- `auth-email` edge fn already implements **standard-webhooks HMAC-SHA-256** verification (`webhook-id` / `webhook-timestamp` / `webhook-signature`, `whsec_` secret) — the same scheme Resend uses.
- `attachments` is polymorphic (`parent_type` ∈ client/deal/job/lead, `parent_id`) and already logs to `activity_log`.
- `user_tasks` has a direct `client_id`; `assigned_tasks` has a denormalized `client_id` (populated by trigger). Neither logs to `activity_log` yet.

## Architecture

**Chosen approach: single event store.** Funnel every source into `activity_log` by adding
one `client_id` column; the client feed becomes a single fast, indexed, paginated query
`WHERE client_id = X ORDER BY created_at DESC`.

Alternative considered and rejected: a read-time UNION RPC across all sources. It avoids a
backfill but produces complex pagination across heterogeneous shapes and the same full-scan
perf risk we already hit and fixed in `global_search`. The single store matches the existing
trigger pattern and keeps all rendering in one formatter.

### 1. Event capture (backend)

- Add `client_id uuid` to `activity_log` (FK `clients(id)` ON DELETE SET NULL, nullable, indexed on `(client_id, created_at desc)`).
- Extend `log_activity()` to derive `client_id` per source table:
  - `clients` → `NEW.id` / `OLD.id`
  - `deals`, `jobs`, `deal_payments` → the row's client (direct column or via `deal_id`→`deals.client_id`)
  - `user_tasks`, `assigned_tasks` → `client_id` column
  - `attachments` → resolve from `parent_type`/`parent_id` (client direct; deal/job → owning client; lead → null)
- Add `log_activity` triggers (insert/update/delete) to **`deal_payments`**, **`user_tasks`**, **`assigned_tasks`**.
- Backfill `client_id` on existing `activity_log` rows (best-effort by entity_type joins). Snapshot/backup before backfill.

### 2. Email lifecycle (Phase 2)

- `email_log`: add `client_id` (+ `deal_id`/`job_id` when derivable), `delivered_at`, `bounced_at`; broaden `status` to `queued|sent|delivered|bounced|complained|failed`.
- **Client linkage** via a BEFORE-INSERT trigger on `email_log`: if `client_id` is null, resolve from `to_email` (match `clients` primary email / contacts) and from any `deal_id`/`code` already known. Trigger-based so individual email callers stay untouched.
- New Supabase edge function **`resend-webhook`** (`verify_jwt = false`), reusing `auth-email`'s HMAC verifier, secret env var `RESEND_WEBHOOK_SECRET`. On Resend `email.sent|delivered|delivery_delayed|bounced|complained`, update the matching `email_log` row by `resend_id` (set `status`, `delivered_at`/`bounced_at`).
- Trigger on `email_log` funnels into `activity_log`: insert ⇒ "email sent", relevant status-update ⇒ "delivered"/"bounced".
- **Deployment step (not a code secret):** register the webhook endpoint URL and signing secret in the Resend dashboard; store the secret as a Supabase secret `RESEND_WEBHOOK_SECRET`. (No literal secrets in this repo/docs.)

### 3. Client feed (frontend)

- New hook `useClientActivity(clientId)` → `activity_log` filtered by `client_id`, ordered desc, paginated (load-more, 50/page).
- Repurpose the client **Activity tab** to render the unified feed. The generic `ActivityPanel` stays unchanged for deal/job/lead detail pages (still entity-scoped).
- Extend `src/features/activity/format.ts` with friendly renderers (EN/EL) for:
  - **payment** events — "Payment of €X created (pending)", "Payment marked paid", "Payment set back to pending", "Payment deleted".
  - **email** events — template_key → friendly name + outcome ("Welcome email sent", "Payment reminder delivered", "Email bounced").
  - **task** events — "Task '…' created", "Task completed".
  - **attachment** events — "Uploaded invoice.pdf", "Deleted receipt.pdf".
- Filter chips: All / Payments / Emails / Jobs / Deals / Files / Tasks (default All).

### 4. Actor labelling

Manual actions show the acting user (`auth.uid()` at trigger time). Automated events
(payment cron, sent emails, onboarding triggers, service-role) show **"System"** — this is
expected and consistent with the rest of the app, not a defect.

## Phasing

- **Phase 1** — unified feed for payments, jobs, deals, attachments, tasks:
  `activity_log.client_id` + `log_activity()` extension + payment/task triggers + backfill +
  `useClientActivity` + formatter + filter chips. Independently shippable.
- **Phase 2** — email send + delivery: `email_log` columns + linkage trigger + `resend-webhook`
  edge fn + email→activity funnel trigger + email formatter + Resend dashboard config.

## Testing (TDD)

- Pure formatter unit tests for every new event string, both languages.
- SQL trigger tests: payment insert ⇒ activity row carrying `client_id`; status flip ⇒ "paid" event; task create/resolve ⇒ events.
- `resend-webhook` unit test: signature verification + Resend-event → `email_log.status` mapping.
- Live smoke on a real client (role-switching per the established RLS-test technique).

## Changes / Revert

- Every migration is additive and carries rollback SQL (drop `client_id` column + new triggers, restore prior `log_activity()`); backup table before the backfill.
- `email_log` new columns and the webhook are additive; revert = drop columns/triggers and redeploy the prior `send-email`.
- No destructive changes to existing data.

## Open items deferred to the plan

- Exact friendly-name map for `template_key` values (≈15 templates).
- Whether to also surface `email.opened`/`clicked` (default: no, to limit noise).
- Pagination page size tuning if a client has very high event volume.
