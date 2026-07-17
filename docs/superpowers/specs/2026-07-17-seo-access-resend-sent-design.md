# SEO Access Email — Resend for Already-Sent Emails

**Date:** 2026-07-17
**Status:** Approved

## Problem

SEO jobs (web_seo → GSC access email, local_seo → GBP access email) show an
onboarding-email status badge (`JobEmailStatusBadge`) on kanban cards and the
job detail header. When the email has **not** been sent, the badge offers a
Resend action (confirm dialog → `useRequestSeoAccess`). When the email **has**
been sent, the badge is display-only (green "Sent · date") — there is no way to
re-send the access email from the UI, e.g. when a client lost it or access must
be re-requested.

`useRequestSeoAccess` already permits re-sends (no dedupeKey), so this is
purely a UI gap.

## Decision (owner-approved)

Make Resend available in the `sent` state too, in **both** placements:

1. **`canSend`** in `JobEmailStatusBadge.tsx` becomes
   `(state === 'not_sent' || state === 'sent') && templateKey !== null && email !== ''`.
   `coming_soon` (services without an onboarding template, incl. AI SEO
   parents) stays non-actionable.
2. **Detail header** (`variant="detail"`, `sent` state): keep the green
   "Sent · date" pill and render the same "Resend" (`seo_access.resend`)
   button used by `not_sent`, opening the same confirm dialog.
3. **Kanban cards** (`variant="card"`, `sent` state): the green dot becomes a
   button (same treatment as the amber dot: `stopPropagation`, opens the
   confirm dialog). Tooltip: "Sent · date — click to resend".
4. **Confirm dialog**: when the email was already sent, append a line under
   the existing body: "Last sent on {date}" — a guard against accidental
   duplicate sends.
5. **After send**: the existing `seo-access-sent-map` invalidation refreshes
   the badge date automatically. No changes there.

## Out of scope / unchanged

- No backend or edge-function changes. Server-side guards keep applying:
  pay gate (access email requires a paid payment) and the closed-clients
  block; their errors surface via the existing `window.alert` path.
- `jobEmailStatus()` state derivation is unchanged.
- AI SEO children are ordinary `local_seo`/`web_seo` jobs — covered
  automatically; AI SEO parents remain `coming_soon`.

## i18n

Two new keys in `seo_access` (el + en `common.json`):

- `sent_resend_hint` — card-dot tooltip suffix, e.g. el
  "Εστάλη · {{date}} — κλικ για επαναποστολή" / en
  "Sent · {{date}} — click to resend".
- `last_sent_line` — confirm-dialog line, e.g. el
  "Είχε σταλεί ξανά στις {{date}}." / en "Last sent on {{date}}.".

All other copy reuses existing keys (`seo_access.resend`, confirm
title/body from `seoAccessConfig`).

## Testing

Extend the existing component/unit test pattern
(`src/features/jobs/jobEmailStatus.test.ts` and a component test for the
badge):

- `sent` + detail variant renders a Resend button; clicking opens the dialog
  and confirms → mutation called with correct `templateKey`/`to`.
- `sent` + card variant: green dot is a button; click does not propagate to
  the card and opens the dialog.
- Dialog in `sent` state shows the last-sent line; `not_sent` state does not.
- `coming_soon` and missing-email cases remain non-actionable.

## Files touched

- `src/features/jobs/JobEmailStatusBadge.tsx`
- `src/i18n/locales/el/common.json`, `src/i18n/locales/en/common.json`
- test files alongside

## Changes / Revert

- Frontend-only, single atomic commit expected.
- **Revert:** `git revert <commit>` — no data, schema, or edge-function
  changes; nothing else to roll back.
