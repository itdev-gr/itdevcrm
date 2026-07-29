# Same-day payment-reminder aggregation — design (2026-07-29)

## Problem

`enqueue_payment_reminders()` (06:00 cron via `run_daily_payment_reminders()`)
emits **one outbox row per `deal_payments` row** (dedupe `pay_soon:<payment_id>`
etc.). A deal with two installments due the same date gets two
identical-looking emails the same morning (e.g. 000362/000477 on 2026-06-27 —
confirmed in `email_log`: two rows, different `pay_soon:<payment_id>` keys).
Owner decision 2026-07-29: send ONE aggregated email instead.

## Fix

Rewrite `enqueue_payment_reminders()` (migration
`20260729100000_payment_reminders_same_day_aggregate.sql`) to classify each
qualifying payment exactly as today (same joins, guards, stage locks and
windows — verbatim from `20260702140000`), then **group by
`(deal_id, template, due_date)`** and enqueue one outbox row per group:

- `amount_gross` = SUM of the group's amounts (prod templates print only
  `{{code}}`, `{{due_date}}`, `{{amount_gross}}` — no body change needed).
- `service_type` = `string_agg(distinct …, ' + ')` (unused by the live DB
  templates; keeps the built-in fallback renderable).
- Group dedupe key: `<prefix>:<deal_id>:<YYYYMMDD>` (e.g.
  `pay_soon:6cdf…:20260805`). Cannot collide with the legacy
  `<prefix>:<payment_id>` scheme (extra segment).
- **Transition guard:** payments whose legacy per-payment key is already
  sent/pending are excluded from grouping, so nobody already reminded gets a
  second email post-deploy; the not-yet-reminded remainder of a group still
  emails once (its own sum).

## Accepted trade-offs

- A payment ADDED to a deal after its (deal, template, due_date) group email
  went out is silently covered by that earlier email (group key already
  sent). Previously it would have received its own reminder. Rare, benign —
  the client was already reminded for that date.
- Per-payment keys are no longer written for new sends; they remain only as
  historic guards.
- Different due dates on the same deal still email separately (subject
  carries the date) — the owner's ask covers same-day only.

## Verification

`supabase/tests/enqueue_payment_reminders.sql` (RAISE-style prod harness,
savepoint-rollback) gains: SL15 two same-day pending payments → exactly 1
`payment_due_soon` row with summed `amount_gross` + group-format dedupe key,
and still 1 after a second run; SL16 two different-day payments → 2 rows;
SL17 legacy transition — one payment pre-marked sent under
`pay_soon:<payment_id>` → 1 row covering only the other payment's amount.
Harness runs against prod inside rolled-back transactions — execute only
alongside the Task-3 apply step (needs sbp token), never casually.

## Rollback

The migration footer carries the verbatim pre-aggregation function body
(from `20260702140000` Section 1) as a commented CREATE OR REPLACE.
Before applying to prod, dump `pg_get_functiondef('enqueue_payment_reminders'::regproc)`
and diff against that body — prod fn drift has happened before
(see reference_flip_fix_prod_drift).
