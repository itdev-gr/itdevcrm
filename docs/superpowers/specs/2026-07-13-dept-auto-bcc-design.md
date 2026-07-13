# Automatic department Bcc on CRM sends — design

**Date:** 2026-07-13 · **Status:** approved by owner (chat) · **Extends:** [2026-07-13-email-cc-bcc-design.md](2026-07-13-email-cc-bcc-design.md)

## Goal

Every email staff send/reply through the CRM (personal Gmail sends, `identity='personal'`)
is automatically Bcc'd to the sender's department mailbox:

| Sender's group `parent_label` | Auto-Bcc |
|---|---|
| Sales | sales@itdev.gr |
| Accounting | accounting@itdev.gr |
| Technical (web_dev, web_seo, local_seo, ai_seo, ads, social_media, hosting, support) | support@itdev.gr |

## Owner decisions (2026-07-13, defaults accepted)

1. **Personal CRM sends only.** Automated template emails are untouched (they already
   CC their department boxes and are mirrored into the CRM).
2. **Multi-department senders get ALL their boxes** (someone in sales + web_dev → bcc
   sales@ AND support@). Group-less senders (e.g. `info@itdev.gr`, shared-mailbox
   profiles) get no auto-Bcc.
3. **sales@ delivery only** — not registered for CRM capture (the sender's own Gmail
   capture already records these sends). accounting@/support@ exist (connected);
   **sales@itdev.gr existence is a ROLLOUT GATE** — probe + bounce-check before
   declaring done; if missing, owner creates it.

## Design

1. **Pure helper** `deptBccFor(parentLabels: string[]): string[]` in
   `supabase/functions/_shared/recipients.ts` (same dependency-free module as
   `parseRecipientList` — vitest-testable cross-tree). Map exactly as the table above;
   unknown/duplicate labels ignored; output deduped, lowercase.
2. **Wiring** in `sendPersonal` (send-email/index.ts): after the profile fetch, load
   the sender's labels via the service-role client
   (`user_groups → groups(parent_label)`, same embed pattern as the identity-lock
   block), compute `autoBcc`, and build the final bcc as
   `dedupe([...callerBcc, ...autoBcc])` MINUS any address already present in `to` or
   `cc` (case-insensitive). The admin-only gate on CALLER-supplied bcc is unchanged
   and runs before this — the system Bcc is appended server-side afterwards, for every
   sender, admin or not.
3. **Recording:** nothing new — the sender's Gmail sent copy carries the merged Bcc
   header; gmail-sync already captures it into admin-only `email_message_bcc`.
4. **Transparency:** compose dialog (personal identity) hint line gains
   `dialog.dept_bcc_hint`: EN "A copy is sent automatically to your department's
   mailbox." / EL "Ένα αντίγραφο αποστέλλεται αυτόματα στο γραμματοκιβώτιο του
   τμήματός σας."

## Out of scope (YAGNI)

Auto-bcc on automated/Resend sends; registering sales@ as a captured shared mailbox;
per-user or per-department opt-outs; changing the existing automated CC routing.

## Testing

- Unit (vitest, TDD): `deptBccFor` — each label maps; multi-label; unknown label
  ignored; duplicates collapsed; empty → [].
- E2E at rollout: (a) **probe** — send a CRM email To sales@itdev.gr, watch the
  sender's mailbox ~3 min for a Mailer-Daemon bounce (none = exists); (b) Maria
  (web_dev → support@) sends from a lead → captured sent copy's bcc row =
  `support@itdev.gr`; (c) a sales rep (azazas, Gmail-connected) sends → bcc row =
  `sales@itdev.gr`; (d) admin manual bcc + auto-bcc merge (no dupes) when both used.

## Changes / Revert

Changes: `_shared/recipients.ts` (+helper +tests), `send-email/index.ts`
(sendPersonal), `SendEmailDialog.tsx` hint, i18n en/el; send-email redeploy. No
migration. Revert: git revert + redeploy send-email.
