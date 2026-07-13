# IT DEV branded email signature — design

**Date:** 2026-07-13 · **Status:** approved by owner (chat)

## Goal

Every email leaving the CRM ends with the same branded IT DEV signature (logo card +
Greek confidentiality disclaimer), in two variants:

- **Company variant** — on all automated client-facing emails (payment reminders, lead
  sequences, onboarding, contracts, …). No rep name — uniform branding (owner decision).
- **Personal variant** — on emails staff send/reply through the CRM via their connected
  Gmail (`identity='personal'`): same layout, but the user's full name, job title, phone
  and email. Users manage it from **My Profile**; they can only fill fields, never edit
  layout, so everyone's signature has the identical form.

## Signature content (from owner's reference image)

Layout, top to bottom (email-safe HTML: nested tables + inline styles only):

1. `Με εκτίμηση,`
2. Card: round IT DEV logo (~80px) · vertical rule · text block:
   - **Bold line** — company: `IT DEV` / personal: user's full name
   - Blue line — company: `Digital Marketing Agency` / personal: user's job title
   - `Tel.:` — company: `+30 210 260 3414` / personal: user's phone
   - `A.: Argous 139, Athens, 104 41` (fixed)
   - `E:` mailto link — company: `info@itdev.gr` / personal: user's email
   - `Web:` link — `www.itdev.gr` (fixed)
3. Disclaimer block (small, gray, Greek — identical for everyone):
   - **ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:** Το περιεχόμενο του παρόντος email είναι εμπιστευτικό και
     προορίζεται αποκλειστικά για τον/την παραλήπτη/παραλήπτρια που αναφέρεται στο
     μήνυμα. Απαγορεύεται αυστηρά η κοινοποίηση, αναπαραγωγή ή διανομή οποιουδήποτε
     μέρους του μηνύματος σε τρίτους χωρίς την έγγραφη συγκατάθεση του αποστολέα. Εάν
     λάβατε αυτό το μήνυμα κατά λάθος, παρακαλώ απαντήστε σε αυτό το email και προβείτε
     στη διαγραφή του, ώστε να διασφαλίσουμε ότι δεν θα επαναληφθεί παρόμοιο σφάλμα στο
     μέλλον.
   - **Επιπλέον σημείωση:** Για οποιοδήποτε αίτημα ή αλλαγή που αφορά τις υπηρεσίες μας,
     παρακαλούμε όπως γίνεται αποστολή γραπτού αιτήματος μέσω email. Αυτό είναι σημαντικό
     προκειμένου να διατηρείται αρχείο και να διασφαλίζεται η ορθή παρακολούθηση και
     διαχείριση των ενεργειών.

Personal-variant fallbacks: empty job title → omit the blue line; empty phone → omit the
`Tel.:` row. Name and email always exist (profiles).

## Current state (explored 2026-07-13)

- Automated emails: `supabase/functions/send-email/templates.ts` — every send passes
  through `shell()` (lines 19–25), whose only footer is `ITDEV · itdev.gr`. The
  `Με εκτίμηση, …` sign-offs live inside ~25 `email_templates.body` DB rows (plain text,
  `\n`→`<br/>`; DB rows may have drifted from migration seeds — DB is authoritative).
- CRM personal sends: `SendEmailDialog.tsx` → `useSendEmail.ts` → `send-email` edge fn
  `sendPersonal()` (index.ts:206–235) → Gmail API via `buildMime` (`_shared/google.ts`).
  **No wrapper, no signature today.** Shared-identity custom sends (accounting@/support@)
  go through Resend + `TEMPLATES.custom` → `shell()`.
- Profiles already carry `full_name`, `job_title`, `phone`, `phone_extension`, `email`
  (self-editable, column-grant, `20260503000004_profile_self_edit.sql`); edited on
  `/profile` (`src/features/users/MyProfilePage.tsx`, autosave).
- No email embeds images today; no public storage bucket exists; no hosted-asset pattern.

## Design decisions

1. **One renderer, code-level.** New dependency-free module
   `supabase/functions/_shared/signature.ts` exporting
   `renderSignature(variant: 'company' | { name, title, phone, email })` → HTML string.
   The frontend needs the same renderer for the live preview; prefer importing that exact
   file from `src` (vite can), and if `npm run build` (tsc -b + eslint, strict) rejects
   cross-tree imports, keep a copy in `src/lib/emailSignature.ts` with a **parity test**
   that renders both and asserts identical output.
2. **Automated emails:** `shell()` appends the company signature **only for
   client-facing** sends (DB rows have `client_facing`; built-in `internal_*` templates
   keep the minimal `ITDEV · itdev.gr` footer — no disclaimer on staff notifications).
   The logo `<img>` uses a hosted public URL.
3. **Strip old sign-offs from DB templates** so nothing signs twice. One migration:
   back up `email_templates` to `email_templates_backup_20260713`, then defensively
   remove a trailing sign-off block: `Με εκτίμηση,` followed by up to two short closing
   lines drawn from `{{owner_name}}` / `Η ομάδα της ITDEV` / `ITDEV` / `ITDEV Λογιστήριο`
   (brand matched case-insensitively — seeds used both `ITDev` and `ITDEV` — tolerating
   trailing whitespace/newlines, anchored to end-of-body). SEO-onboarding contact-person
   closings are NOT sign-offs — leave them. Verify by selecting all bodies after the
   update.
4. **Personal sends:** `sendPersonal()` loads the sender's profile (service-role client,
   user id already known from JWT), appends the personal signature to the HTML body
   (and a plain-text rendering to the text part). Shared-identity custom sends get the
   company variant via `shell()` (they are client-facing). Mirrored thread copies
   (`email_messages`) naturally include whatever was sent.
5. **Logo hosting:** migration creates **public** storage bucket `email-assets`; the
   round logo (cropped from the owner's reference screenshot, ≥160px, PNG with
   transparency) is committed to the repo (`docs/assets/itdev-logo-round.png`) and
   uploaded once to `email-assets/itdev-logo-round.png`; signature references
   `<SUPABASE_URL>/storage/v1/object/public/email-assets/itdev-logo-round.png`.
6. **My Profile — "Email signature" section:** live preview (iframe/`srcDoc` with the
   rendered HTML) driven by the existing name / job title / phone / email fields on the
   page; helper text (EN/EL i18n) explains these fields feed the signature. No new
   schema, no free-form HTML. `SendEmailDialog` gets a small read-only hint + collapsible
   preview ("Η υπογραφή σας προστίθεται αυτόματα") so senders know it's appended.

## Out of scope (YAGNI)

Per-user logo/layout overrides; signature on internal notification emails; rich-text
compose; quoting original message in replies; EN translation of the disclaimer.

## Testing

- Unit: renderer variants + fallbacks (missing title/phone); parity test if duplicated.
- Migration: row-by-row prod verification that bodies lost exactly the sign-off tail.
- E2E after deploy: one automated client-facing email (e.g. re-send an onboarding email
  to a test address) + one CRM personal send/reply — inspect real inbox rendering
  (Gmail web at minimum), logo loads, links work, no double sign-off.

## Changes / Revert

Changes: 2 migrations (bucket; template-strip w/ backup), edge fn `send-email`
(+`_shared/signature.ts`), `MyProfilePage`, `SendEmailDialog`, i18n en/el, logo asset,
one-time logo upload. Revert: `update email_templates t set body = b.body, subject =
b.subject from email_templates_backup_20260713 b where b.key = t.key;` · redeploy
previous `send-email` · remove profile/dialog sections (git revert) · (optional) delete
bucket object + bucket.
