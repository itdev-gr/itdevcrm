# Email mirror dedup — design (2026-07-29)

## Problem

Members report the same email appearing 2+ times in deal **Mail** tabs. Prod
analysis (6,157 `email_messages` rows, 2026-07-29) found 414 true-duplicate
clusters:

1. **mirror+capture (279 clusters, ALL July, growing daily — root cause).**
   Every automated Resend send is recorded twice:
   - `send-email` writes a *mirror* row at send time with synthetic
     `message_id = 'resend:<resend-id>'` (instant visibility in the tab);
   - `gmail-sync` later captures the dept-CC copy (accounting@/support@ are
     CC'd on automated sends and are connected mailboxes) with the **real**
     RFC822 Message-ID (`<...@eu-west-1.amazonses.com>`).
   The `email_messages.message_id` unique constraint cannot collapse them —
   the strings never match. The mirror usually has `thread_id NULL` while the
   capture has a Gmail thread id, so the two rows even render as two separate
   thread cards.
2. **Real double-sends (send-side, explains "more than 2").**
   (a) Deals with 2+ payment rows due the same date get one reminder per
   payment (`pay_soon:<payment_id>` dedupe keys differ) — identical subject.
   (b) Manual access-email resends (`localseo_gbp_access` sent 3× on one deal,
   same dedupe_key — the key is logged, not enforced across time).
   Each such send then doubles via (1) → 4–6 rows.
3. **Historic human double-sends** backfilled from shared boxes (Apr–Jun,
   pre-CRM Gmail usage) — genuinely sent twice; cosmetic, left as-is.

## Fix (this change addresses mechanism 1 only)

**Layer A — deterministic Message-ID at send time.** `send-email` generates
`<crm-<uuid>@itdev.gr>`, passes it as the `Message-ID` header in the Resend
payload (`headers` field), and uses the same string as the mirror row's
`message_id`. If Resend/SES preserves the header (expected for raw MIME), the
captured copy carries the same Message-ID and the unique constraint dedups it
with zero further logic.

**Layer B — sync-side mirror adoption (robust regardless of SES header
behavior).** `gmail-sync`, before inserting a captured message:
- If a row with the same `message_id` exists but has no `gmail_id` (mirror
  whose header was preserved): upgrade it in place with Gmail metadata
  (`gmail_id`, `thread_id`, `body_text/html`, `snippet`,
  `captured_from_user_id`).
- Else look for an **un-adopted mirror twin**: `message_id LIKE 'resend:%'`
  OR `LIKE '<crm-%'`, same `to_email`, same `subject`, same
  `deal_id`/`lead_id` (null-safe), `direction='outbound'`, `sent_at` within
  ±30 min. Adopt the nearest: update it in place to the real `message_id` +
  Gmail metadata. A `.eq('message_id', <old>)` guard makes the update a no-op
  if another sweep adopted first; on failure fall through to today's plain
  upsert (`ignoreDuplicates`).
Adoption keeps the original row `id`, so `email_message_bcc` children stay
attached. The existing bcc union-merge block keys on `message_id` and works
unchanged for all paths.

**Layer C — backlog cleanup.** One-time SQL
(`supabase/migrations/20260729090000_email_mirror_dedup.sql`): pair each
`resend:%` mirror with its nearest captured twin (same predicate as Layer B,
1:1 greedy assignment so a capture can absorb at most one mirror), back up the
mirrors to `email_mirror_dedup_backup_20260729`, fold mirror bcc/cc into the
kept row, delete the mirrors. Unpaired mirrors (sole record of a send, e.g.
sales emails CC'd to an unconnected rep) are kept. Rollback = reinsert from
the backup table (SQL in the migration footer).

## Out of scope (flagged to owner)

- Aggregating same-day per-payment reminders into one email per deal
  (mechanism 2a) — product decision.
- Enforcing `dedupe_key` across time for manual resends (2b) — resend is a
  deliberate staff action today.
- Deleting historic genuine double-sends (3).

## Rollback

- Code: revert commits (each task is atomic).
- Data: `email_mirror_dedup_backup_20260729` holds every deleted row +
  `kept_twin_id` + `mirror_bcc`; reinsert per the migration footer.
