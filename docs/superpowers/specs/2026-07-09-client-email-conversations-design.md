# Client Email Conversations — Design Spec

**Date:** 2026-07-09
**Status:** Draft for review

## Goal

Capture two-way client email into the CRM (HubSpot-style). When a staff member
and a client email each other, that conversation appears on the **deal** (and on
the **job** if the subject carries a job code), tagged by **department**, and
visible only to the people whose rights allow it.

## What already exists (build on, don't rebuild)

- **Per-user Google connection.** Each staff member connects their `@itdev.gr`
  Google account. The connect flow now requests `gmail.readonly` in addition to
  `gmail.send` and records the granted scopes on `user_google_accounts.scopes`
  (deployed 2026-07-09; **only mkifokeris has reconnected with read so far**).
- **Outbound send** (`send-email` edge fn): personal Gmail send + Resend
  department identities. `email_log` = outbound *delivery metadata* (no bodies).
- This feature **adds inbound capture + full two-way conversation storage + a
  conversation UI.** `send-email` / `email_log` are unchanged.

## Locked decisions

| Area | Decision |
|---|---|
| **Capture** | Read each connected user's Gmail; background poll ~every 5 min; backfill **last 90 days** on first connect. |
| **Privacy filter** | Store a message **only if a From or To party is a known client/contact/lead**. **CC is ignored entirely.** Personal/internal mail is never stored. |
| **Client match** | By the external **From/To** address → client/contact/lead. |
| **Deal match** | Every client email lands on the **deal**. No code + multiple deals → the client's **newest active deal**. |
| **Job match** | If the subject has a code (`000280-WEBDEV`) → attach to that **job** too, **and keep it on the deal**. |
| **Department tag** | One department per email — from the **staff sender/receiver's** department (`sales` / `accounting` / `technical`). CC not considered. |
| **Visibility (DB-enforced)** | See an email if: its **department ∈ your groups**, OR **you were the sender/receiver**, OR you're an **admin**. |
| **Dedup** | One row per RFC822 `Message-ID` — the same email in two mailboxes is stored once. |
| **Rollout** | Build + test with **mkifokeris only**, validate end-to-end, then enable for everyone (each reconnects for read). |

## Architecture

### Data model

`email_messages`
- `id` (uuid pk), `message_id` (text, RFC822, **unique** — dedup key),
  `gmail_id`, `thread_id`
- `direction` (`inbound` | `outbound`), `from_email`, `from_name`, `to_email`,
  `subject`, `body_text`, `body_html`, `snippet`, `sent_at`
- `client_id`, `deal_id`, `job_id` (nullable), `department`
  (`sales`|`accounting`|`technical`)
- `staff_user_id` — the internal party (the one whose department tags it; also
  the "you were sender/receiver" check)
- `captured_from_user_id` — whose mailbox we read it from
- `created_at`

Because both parties of a stored email are (exactly) one client + one staff
member (staff↔staff never matches a client, so it's dropped), `staff_user_id`
is unambiguous. CC addresses are **not stored** and never affect logic.

`user_google_sync` — per-user cursor: `user_id`, `last_history_id`,
`last_synced_at`, `backfilled_at`.

### Access control (RLS on `email_messages`)

`SELECT` allowed when:
`current_user_is_admin()` **OR** `staff_user_id = auth.uid()` **OR**
`department` is one of the caller's group codes.

This enforces the siloing at the database, not just the UI.

### Sync engine (edge function + cron)

- A cron (every ~5 min) invokes a `gmail-sync` edge function (service-role /
  drain-secret gated, same pattern as the email drain).
- For each connected user holding `gmail.readonly`:
  - **First run:** list messages `newer_than:90d`.
  - **Incremental:** Gmail History API from `last_history_id` (fallback:
    `newer_than:` since `last_synced_at`).
  - For each message: fetch headers + body; take **From/To** only; find a client
    match; **if none → skip (not stored).** Parse code → job + deal; else →
    newest active deal. Resolve department from the staff party's group. Upsert
    keyed on `message_id`. Advance the cursor.
- **Test phase:** the sync is gated to **mkifokeris only** (allowlist). Rollout
  = remove the gate.

### Matching details

- **Code:** `\b(\d{6})-([A-Z]{3,})\b` → look up the job by code → its deal.
- **Client:** normalize address; match `clients.email`, contact emails, lead
  emails.
- **Newest active deal:** the client's non-closed, non-archived deals ordered by
  `created_at desc`, limit 1.
- **Department:** the staff party's group(s); if they belong to more than one,
  tie-break by a fixed priority (proposed: `technical` > `accounting` > `sales`
  — confirm on review).

### UI

- **Deal → new "Emails" tab:** the conversation, grouped by thread, filtered by
  RLS to what the viewer may see, with a **Reply** button (reuses the existing
  "send as yourself" flow, prefilled `Re:` + recipient).
- **Job → Emails:** the slice where `job_id` matches.
- **Client → Emails:** everything for that client (still department-siloed).

### Privacy posture

- Only client-matched From/To threads are stored; CC ignored; personal/internal
  mail never touched. Bodies are stored (needed for the conversation view),
  protected by the siloing RLS, and only ever for client threads. Staff opt in
  explicitly by granting the read scope.

## Build order (phased)

**Phase A — capture backend + test on mkifokeris**
1. `email_messages` + RLS + `user_google_sync` cursor.
2. `gmail-sync` edge fn (backfill + incremental), gated to mkifokeris.
3. Matching + department tagging (code parser, client matcher, dept resolver).
4. Validate end-to-end against mkifokeris's real mailbox.

**Phase B — UI**
5. Deal Emails tab (then job/client), reply integration.

**Phase C — rollout**
6. Remove the mkifokeris-only gate; everyone reconnects for read; monitor volume.

## Testing

- **Unit (TDD):** code parser, client matcher, department resolver, newest-active
  deal, RLS siloing (role-switch tests).
- **Integration:** run the sync against mkifokeris's real mailbox; verify the
  captured `000280-WEBDEV` / `005188-WEBDEV` threads land on the right deal+job.

## Changes / Revert

- **Adds:** `email_messages` (+RLS), `user_google_sync`, `gmail-sync` edge fn,
  a cron job, the Emails tab UI.
- **Rollback:** unschedule the cron, delete `gmail-sync`, drop the two tables,
  remove the UI tab. The read scope on the connect flow can stay (harmless) or
  be reverted to send-only.

## Open items (defaults chosen — confirm on review)

- No-code email → **newest active deal** (default; alternatives: client-level
  only / all deals / manual tray).
- Sync **poll ~5 min + 90-day backfill** (default; alternatives: 12-month
  backfill / push notifications / no backfill).
- Department **tie-break** when a staff member is in multiple groups.
- Whether to store CC addresses for *display only* (currently: not stored).
