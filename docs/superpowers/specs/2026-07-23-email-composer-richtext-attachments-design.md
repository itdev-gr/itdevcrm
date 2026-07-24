# Email composer: rich text + attachments — design

Date: 2026-07-23
Status: implemented + DEPLOYED 2026-07-24 (commits d84751c → bdb47e0). send-email edge fn deployed to prod; composer verified live (rich-text toolbar + attach paperclip render in the Send-email dialog on prod). **End-to-end DELIVERY smoke still pending** a Gmail-connected sender: the logged-in test account info@itdev.gr is NOT Gmail-connected (composer shows "Connect Google"); a real formatted-email-with-attachment delivery test needs a connected account (e.g. mkifokeris@itdev.gr) — not run to avoid impersonating a user's Gmail. Follow-up hardening tickets (deferred, non-blocking): (1) fetchMimeAttachments size-check-before-download bound; (2) constrain `attachments`-bucket refs to the `email/` prefix; (3) shared global jest-dom vitest setup so file-scoped email tests stop red.

## Goal

Upgrade the CRM's outgoing email composer (the "New email" and "Reply" flows staff use to email clients) so the **recipient receives**:
1. **Formatted text** — bold, italic, underline, text colour, bullet/numbered lists, links (email-basic).
2. **File attachments** — multiple files, any type, up to ~18 MB total (Gmail's real limit after base64 encoding).

Two phases; Phase 1 (rich text) is mostly frontend, Phase 2 (attachments) requires a backend MIME rebuild.

## Owner decisions (2026-07-23)

- Formatting scope: **email-basic** — bold, italic, underline, colour, bullet + numbered lists, link. No font sizes/headings/inline images.
- Attachments: multiple files, any type; total-size guard (~18 MB raw, so the base64 message stays under Gmail's 25 MB).
- Editor: lightweight `contentEditable` + toolbar (no heavy editor dependency). Add DOMPurify for sanitisation only.
- **Non-goal (owner-accepted):** the CRM's own Emails tab keeps rendering sent copies as plain text without attachment chips (pre-existing limitation; personal Gmail sends are captured later by `gmail-sync`, which drops attachments, and the tab distils HTML→text). Rich in-CRM rendering is a separate future enhancement.

## Current architecture (from the codebase sweep)

- Compose UI: single `src/features/email/SendEmailDialog.tsx` for both New email + Reply; body is a plain `<textarea>` (state `text`). Entry points all pass `identity="personal"` (`EmailThreadList.tsx` New/Reply, deal/lead/proforma detail pages).
- Send: `src/features/email/useSendEmail.ts` → currently `html = body.replace(/\n/g,'<br/>')` (L17) → invokes `send-email` edge fn with `{ identity, to, templateKey:'custom', data:{ subject, html, text }, dedupeKey, cc, bcc }`. **An `html` field already flows to the backend.**
- Backend `supabase/functions/send-email/index.ts` `sendPersonal()` (L235-306): requires the sender's user JWT; wraps `data.html` in a div + appends the IT DEV signature (L290); `buildMime(...)` → `sendGmail(...)`.
- `supabase/functions/_shared/google.ts` `buildMime()` (L108-123): **single-part `text/html`, base64, no multipart, no attachments.**
- `supabase/functions/send-email/attachments.ts`: `fetchAttachments()` (service-role storage download) + `toBase64()` exist but are wired only into the Resend/template path; `ALLOWED_BUCKETS = {contract-pdfs, offer-pdfs}`, `MAX_ATTACHMENTS = 3`.
- Reusable frontend infra: `src/features/comments/CommentAttachButton.tsx` (paperclip + pending chips), `useFileDropPaste.ts` (drag-drop + paste), `src/lib/sanitizeStorageKey.ts` (`sanitizeStorageFileName`), the shared `attachments` storage bucket, and `src/features/email/htmlToText.ts` (HTML→text, for the plain-text fallback).

## Phase 1 — Rich text

### New component `src/features/email/RichTextEditor.tsx`
- A controlled `contentEditable` div + a small toolbar (shadcn `Button` + lucide icons) with: **Bold, Italic, Underline** (`document.execCommand('bold'|'italic'|'underline')`), **text colour** (a small palette popover → `execCommand('foreColor', false, <hex>)`), **bullet list / numbered list** (`insertUnorderedList` / `insertOrderedList`), **link** (prompt for URL → `createLink`; force `rel="noopener noreferrer"` + `target="_blank"` post-hoc).
- Props: `value: string` (HTML), `onChange: (html: string) => void`, `placeholder`, `disabled`. Emits the div's `innerHTML` on input.
- Note: `execCommand` is legacy-but-universally-supported for these commands; output is normalised by sanitisation on send.

### Sanitisation
- Add **DOMPurify** (new dependency). A `src/features/email/sanitizeEmailHtml.ts` wrapper with a strict allowlist:
  - `ALLOWED_TAGS`: `p, br, b, strong, i, em, u, a, ul, ol, li, span, div`.
  - `ALLOWED_ATTR`: `href, target, rel, style`.
  - Restrict `style` to `color` only (DOMPurify `uponSanitizeAttribute` hook strips any non-`color` style declarations).
  - `href` restricted to `http/https/mailto` (DOMPurify default URI policy).
- Sanitise on send (and defensively when loading any draft HTML into the editor).

### Send-path change (frontend only)
- `SendEmailDialog`: replace the `<textarea>` with `<RichTextEditor>`; hold the body as HTML.
- `useSendEmail`: send `html = sanitizeEmailHtml(bodyHtml)` (real author HTML, not `\n→<br/>`), and `text = htmlToText(bodyHtml)` for the plain-text field. Backend already wraps `data.html` + signature → **no backend change for Phase 1.**
- Result: the recipient's email is formatted.

## Phase 2 — Attachments

### Frontend staging (`SendEmailDialog`)
- Reuse `CommentAttachButton` + `useFileDropPaste` for the paperclip + drag-drop + paste UX, holding `pending: File[]`.
- New hook `src/features/email/hooks/useEmailAttachmentStaging.ts` (storage-only, NO DB row): on add, upload each file to the `attachments` bucket at `email/<stagingId>/<Date.now()>-<sanitizeStorageFileName(name)>`, tracking `{ bucket:'attachments', path, filename, size, mimeType }` refs in component state; support remove (storage `.remove` + drop ref); enforce per-file 25 MB and **total ≤ 18 MB** (sum of raw sizes) with a clear error.
- On send, pass `attachments: AttachmentRef[]` (the staged refs) into the send mutation.
- After a successful send, best-effort delete the staged objects (storage `.remove` of the `email/<stagingId>/…` paths). On failure keep them (retry-safe).

### Send mutation + edge function
- `useSendEmail`: add `attachments?: AttachmentRef[]` to `SendEmailVars`, forward in the payload.
- `send-email` `sendPersonal()`: when `attachments` present, `fetchAttachments(refs)` (service-role) → `toBase64(...)` → pass parts to `buildMime`. Extend `ALLOWED_BUCKETS` to include `attachments`; raise `MAX_ATTACHMENTS` (e.g. 10). Enforce the ~18 MB total on the server too (defence in depth); reject over-limit with a clear error surfaced to the composer.
- `buildMime()` (`_shared/google.ts`): **rebuild** to emit `multipart/mixed` when attachments are present — an `Content-Type: text/html` first part (the existing single-part body, unchanged), then one part per attachment (`Content-Type: <mime>; name="<file>"`, `Content-Transfer-Encoding: base64`, `Content-Disposition: attachment; filename="<file>"`, base64 payload). When NO attachments, keep the current single-part output verbatim (backward-compatible). Reuse the existing UTF-8 `btoa`/`b64url` helpers; RFC-compliant CRLF + boundary.
- Result: the recipient's email carries the files.

## Testing
- Frontend (vitest, file-scoped): `RichTextEditor` toolbar commands wrap selection; `sanitizeEmailHtml` strips scripts/`onerror`/disallowed styles/tags and keeps bold/colour/list/link; link gets `rel=noopener`; `useEmailAttachmentStaging` uploads, removes, and blocks over-limit; `useSendEmail` forwards sanitized html + attachment refs.
- Edge function (Deno test if the repo has them, else a documented manual send): `buildMime` produces valid single-part when no attachments (byte-identical to today) and a valid `multipart/mixed` with a decodable base64 part when present; total-size guard rejects over-limit.
- Live smoke: send a formatted email + a small attachment from the composer to a test inbox (e.g. info@itdev.gr); confirm the received email shows formatting + the file; verify staged objects cleaned up. Uses the standing test accounts; caution — vitest hits PROD.
- `npm run build` clean; edge function deploys clean.

## Changes / Revert
- Phase 1 revert: revert the frontend commits (editor + sanitize + send change); remove the DOMPurify dep.
- Phase 2 revert: restore the original single-part `buildMime`; revert `sendPersonal` attachment handling + `ALLOWED_BUCKETS`/`MAX_ATTACHMENTS`; revert the staging UI/hook; redeploy the edge function. Staged storage objects removed via the Storage API (never SQL).
- No DB schema change in either phase.
