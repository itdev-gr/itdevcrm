# Ads notes in the deal Notes area

**Date:** 2026-07-06
**Status:** Approved

## Problem

The Ads job Info tab has an "Ads Notes" field (`jobs.details.ads_notes`). The deal
detail page's Notes area (what accounting reads) already surfaces the other services'
info-tab notes — Web SEO notes (`seo_notes`), Local SEO notes (`local_notes`) and
Website notes (`webdev_notes`) — but Ads notes is missing, so accounting never sees it.

## Design

Follow the existing pattern in `src/features/deals/DealNotesArea.tsx` exactly:

1. Add `const ads = noteFrom(jobs, ['ads'], 'ads_notes')` next to the existing three.
2. Render `{ads.present && readOnlyNote(t('notes_area.ads_notes'), ads.value)}` after
   the Website notes block.
3. Add the `notes_area.ads_notes` label to both locale files:
   - `src/i18n/locales/en/deals.json` → `"ads_notes": "Ads notes"`
   - `src/i18n/locales/el/deals.json` → `"ads_notes": "Σημειώσεις Ads"`

Behavior matches the other service notes: the block appears only when the deal has an
`ads` job, shows "—" when the note is empty, and is read-only here — it is edited from
the Ads job's Info tab. No DB, RLS, or API changes; `useDealJobs` already delivers the
data.

## Testing

Unit test (Vitest) asserting `noteFrom(jobs, ['ads'], 'ads_notes')` picks up an ads
job's note and reports `present: false` when the deal has no ads job — mirroring the
level of coverage the sibling `DealServiceInfo.test.tsx` provides. Manual check:
open a deal that has an Ads job with notes and confirm the block renders in the
Notes area.

## Changes / Revert

- Changes: `DealNotesArea.tsx` (+2 lines), `en/deals.json` (+1 key), `el/deals.json`
  (+1 key), plus a small test.
- Revert: `git revert` of the single commit; no data or schema impact.
