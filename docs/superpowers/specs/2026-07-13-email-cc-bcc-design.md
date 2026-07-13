# CC + BCC in CRM email — design

**Date:** 2026-07-13 · **Status:** approved by owner (chat)

## Goal

CRM composes (all entry points, personal or shared identity) support **Cc** (everyone)
and **Bcc** (**admin-only, entirely** — only admins get the field, and only admins can
ever see recorded Bcc). Captured/mirrored emails record Cc visibly and Bcc behind
admin-only RLS.

## Owner decisions (2026-07-13)

1. **Bcc is admin-only entirely**: non-admins never see the Bcc field, and the server
   rejects `bcc` from non-admin callers (403 `bcc_admin_only`) — UI hiding is not the
   enforcement.
2. CC/BCC available on **all** CRM composes (personal Gmail sends AND shared-identity
   Resend sends).
3. Both fields accept **comma-separated addresses, max 10 each**, validated per
   address, deduped.

## Design

1. **Compose UI (`SendEmailDialog`):** Cc input for everyone; Bcc input rendered only
   when `authStore.isAdmin`. Client-side: split on commas, trim, drop empties, validate
   each against the same address regex as To, cap 10. `useSendEmail` vars gain
   `cc?: string[]`, `bcc?: string[]`, forwarded in the invoke body as `data.cc`/`data.bcc`
   (personal) and top-level `cc`/`bcc` (single-send custom).
2. **send-email edge fn:**
   - Shared helper `parseRecipientList(v: unknown): string[] | null` — accepts array or
     comma-string; per-address `^[^@\s]+@[^@\s]+\.[^@\s]+$`, rejects `\r\n`, dedupes
     (lowercase), caps 10; returns null on any invalid entry (caller returns 400
     `invalid_recipient`).
   - **Personal branch:** caller is a user JWT; load `profiles.is_admin` — if `bcc`
     non-empty and not admin → 403 `bcc_admin_only`. `buildMime` gains optional
     `cc?: string[]`, `bcc?: string[]` → emits `Cc:`/`Bcc:` headers (Gmail delivers to
     Bcc and strips the header from recipients' copies; the sender's sent copy keeps it).
   - **Single-send `custom` (Resend):** user-supplied `cc` MERGES with the existing
     department-CC logic (dept cc + user cc as an array, deduped — Resend accepts
     arrays); `bcc` admin-gated the same way (the branch already resolves `uid` for
     non-service callers; service-role callers never pass cc/bcc). System/automated
     template sends are untouched.
3. **Storage:**
   - `email_messages.cc_emails text` (comma-joined, lowercase) — visible under the
     existing department RLS like every other column.
   - New `email_message_bcc (message_pk uuid primary key references email_messages(id)
     on delete cascade, bcc_emails text not null)` — RLS: SELECT only when
     `current_user_is_admin()`; no client write policies (service-role only).
4. **Capture (`gmail-sync` / `_shared/google.ts`):** `getGmailMessageFull` also parses
   `Cc` and `Bcc` headers via a new `parseAddressList` (the existing `parseAddress`
   handles one mailbox; lists are comma-separated mailbox specs — split on commas not
   inside `"…"` quotes, keep it simple: split on `,` then `parseAddress` each, drop
   empties). gmail-sync upserts `cc_emails` on the row and, when a Bcc header exists
   (sender's sent copy), upserts the admin-only bcc row after the message upsert
   (keyed by the message's uuid; skipped when the message insert was deduped away).
5. **Mirroring (`sendOne`):** the mirrored `email_messages` row records `cc_emails`
   (department cc + user cc); when an admin used bcc, insert the bcc row (service
   role bypasses RLS).
6. **Display (Emails tabs):** thread cards show `Cc: …` under the recipients when
   present. Admins also see `Bcc: …` — fetched via the `email_message_bcc`
   relationship; non-admins' embed returns null rows by RLS, so nothing renders and
   nothing leaks.
7. **i18n:** `dialog.cc` / `dialog.bcc` labels + `dialog.bcc_admin_hint` (EN/EL).

## Out of scope (YAGNI)

Reply-all / CC prefill on reply; filing by CC address (`resolve_email_filing` stays
From/To); CC/BCC on automated template emails; contact autocomplete in the fields.

## Testing

- Unit: `parseRecipientList` (valid/invalid/cap/dedupe/injection) — dependency-free
  module importable by vitest like `signature.ts`; `parseAddressList` for header
  parsing; dialog test: Bcc field hidden for non-admin, shown for admin.
- Live E2E: non-admin compose with Cc (2 addresses) → both delivered, `cc_emails`
  recorded, thread card shows Cc; admin compose with Bcc → delivered, bcc row exists,
  visible on the card as admin, INVISIBLE as non-admin (query as rep returns null);
  server rejection: non-admin request with forged `bcc` → 403.

## Changes / Revert

Changes: 1 migration (cc column + bcc table + RLS), edge fns `send-email` +
`gmail-sync` (+`_shared/google.ts`), `SendEmailDialog`/`useSendEmail`/thread cards,
i18n en/el. Revert: git revert + redeploy both fns; `alter table email_messages drop
column cc_emails; drop table email_message_bcc;` (rollback SQL in migration header).
