# Client Email — Shared company mailboxes (accounting@ + support@)

**Date:** 2026-07-10 · **Status:** approved in conversation (owner answered all design questions)

## Goal

Capture client email flowing through the two shared company mailboxes —
**accounting@itdev.gr** (automated-email replies, billing) and
**support@itdev.gr** (support traffic) — into the same `email_messages`
pipeline, threads, and 3-category Emails tab that personal staff Gmail uses.
Additionally, write the **automated (Resend) sends themselves** into the
threads so shared-mailbox conversations show both sides.

## Owner decisions (07-10)

1. Both are **real Google mailboxes** (login possible) → Option A: connect via
   the existing OAuth/sweep machinery. Domain-wide delegation explicitly deferred.
2. support@ conversations land in the **Technical** category; accounting@ in
   **Accounting**.
3. **Visibility by department rule** (same as personal mail): accounting@ mail →
   accounting group; support@ mail → a new `support` group (bucketed Technical);
   admins see all.
4. **Automated Resend emails are included** in the threads (SENT entries), so a
   client reply has its context.
5. **90-day chunked backfill** for the two shared boxes (staff mailboxes keep 10d).
6. Internal mail (staff ↔ shared box) is skipped, like staff-to-staff today.
7. Reply from the CRM keeps the logged-in user's personal identity; "send as the
   shared mailbox" is deferred as its own future project.

## Design

### Identity model

- Two **service identities**: auth users + `profiles` rows for
  accounting@itdev.gr and support@itdev.gr with `is_active=false`, no group
  memberships, unguessable random passwords (never logged into). Existing
  pickers/rosters filter on `is_active`/groups, so they stay invisible in the app.
- New registry table `shared_mailboxes` (`user_id` FK → profiles, `email`,
  `department` — 'accounting' | 'support', timestamps). Single source of truth
  for "these addresses are company mailboxes" + their fixed department.
- Their Gmail tokens live in `user_google_accounts` under the service
  identities — the sweep picks them up with **zero loop changes** (it already
  iterates read-scoped accounts).

### Connect flow (admin-only)

- The profile-page connect flow binds Gmail to the *clicking* user, so shared
  boxes get a dedicated **Settings → Shared mailboxes** section (admin-gated):
  one row per registry entry with Connect / Disconnect and status.
- Connect passes the shared identity's `user_id` as the OAuth state target
  (google-oauth edge fn already carries user_id in signed state). The edge fn
  additionally validates: a state whose user_id ≠ the initiating session's user
  is allowed only when the target is in `shared_mailboxes` (defense against
  arbitrary-target connect). Exact mechanics per current google-oauth code at
  implementation time.
- Owner performs the two Google logins once, like staff did.

### Filing (`resolve_email_filing` v4)

Because the service identities are `profiles` rows, the existing
one-side-must-be-staff logic already treats shared boxes as "us"
(client↔shared proceeds, staff↔shared skips). One addition:

- After the staff party is determined and when **no job code** matched: if the
  staff-party email is in `shared_mailboxes` → `department :=` the registry
  department (accounting@ → 'accounting', support@ → 'support'), **instead of**
  the staff-group rule. A job code still wins (files on that job's service).
  Lead-matched mail stays `department='sales'` regardless of mailbox (lead page
  is a sales surface).

### `support` group

- New row in `groups`: code `support`, `parent_label='Technical'`,
  display_names en "Support" / el "Υποστήριξη", plus whatever board-permission
  rows the permissions engine needs so `current_user_can('support','view')`
  works for its members (mirror an existing service group's wiring; inspect at
  implementation time). Seeded with **no members** — admins see everything; the
  owner adds members in Settings when ready.
- UI category mapping needs no change: `categoryOf('support')` already buckets
  as Technical (anything not sales/accounting).

### Automated sends → threads

- The send pipeline (send-email edge fn success path), which already writes
  `email_log`, additionally inserts an `email_messages` row per successful
  client-facing send: `message_id = 'resend:'||<resend/email_log id>` (dedup-safe),
  `direction='outbound'`, from = the actual From used, to = recipient,
  subject/body_text from the rendered template, `sent_at=now()`,
  client/deal/job/**lead** from the send context (lead welcome emails file on
  the lead), `department` = job's service_type when
  a job is in context, else 'accounting' for accounting templates, else 'sales'
  (exact mapping from the template's department at implementation time),
  `staff_user_id=null`, `thread_id=null`.
- **Thread adoption:** automated rows start with `thread_id=null` (they never
  saw Gmail). When gmail-sync later stores an inbound reply that has a real
  Gmail `thread_id`, it stamps that thread_id onto rows of the same client (or
  lead) whose
  `thread_id is null` and whose normalized subject (Re:/Fwd: stripped) matches
  the reply's — so the automated original and its replies collapse into one
  conversation. Without a reply, the automated row stands alone via the
  existing subject-chain grouping.
- `internal` templates and non-client sends (password resets etc.) are NOT
  inserted — only sends already associated with a client/deal/lead context.

### 90-day chunked backfill (shared boxes only)

- `shared_mailboxes` rows backfill with `newer_than:90d` instead of `10d`.
- Chunking: `user_google_sync` gains a nullable `backfill_page_token`; a
  backfilling mailbox lists up to 200 messages per sweep and persists the Gmail
  page token between runs; `backfilled_at` is set only when pagination
  exhausts. Incremental mode takes over afterwards. Staff mailboxes are
  unaffected (single-run 10d backfill as today).
- This also keeps each sweep run inside the edge-fn wall clock (the 150s
  idle-timeout behavior observed 07-10 self-heals across ticks, but shared
  boxes should page deterministically rather than rely on that).

## Explicitly out of scope

- Send-as accounting@/support@ from the CRM (Reply stays personal identity).
- Domain-wide delegation (revisit if shared-login management becomes a burden).
- Backfilling automated sends retroactively into threads (only NEW sends get
  rows; history arrives via the 90-day Gmail backfill's captured replies).

## Testing

- Unit: filing v4 probes via SQL (client↔accounting@ uncoded → 'accounting';
  client↔support@ uncoded → 'support'; code beats registry; staff↔shared
  skipped; lead↔support@ → lead + 'sales').
- RLS: support-group member sees support@ mail, non-member doesn't, admin sees
  all (rolled-back role-switch probes).
- Thread adoption: insert automated row + simulated reply → both share thread key.
- Live: owner connects both boxes; verify backfill pages across sweeps until
  `backfilled_at` set; Emails tab shows Accounting/Technical threads on real
  clients; deal Overview status box unaffected.

## Changes / Revert

| Change | Revert |
| --- | --- |
| `shared_mailboxes` table + 2 service identities | drop table; delete the 2 auth users (cascades profiles/user_google_accounts) |
| `groups` +`support` row + permission wiring | delete group row + permission rows (no members seeded) |
| `resolve_email_filing` v4 | restore v3 body from `20260710150000_lead_email_capture.sql` |
| send-email inserts into `email_messages` | redeploy previous send-email (rows keep, harmless) |
| gmail-sync 90d/pagination + thread adoption | redeploy previous gmail-sync; drop `backfill_page_token` |
| Admin Settings section | git revert of the UI commits |
