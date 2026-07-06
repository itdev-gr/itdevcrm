# Ads Notes in Deal Notes Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Ads job's Info-tab notes (`jobs.details.ads_notes`) as a read-only block in the deal detail page's Notes area, exactly like the existing Web SEO / Local SEO / Website notes blocks.

**Architecture:** `src/features/deals/DealNotesArea.tsx` already reads sibling-service notes out of the deal's jobs via the module-local helper `noteFrom(jobs, types, key)` and renders each with `readOnlyNote(...)`. We add one more `noteFrom` call for the `ads` service type, render it after the Website notes block, and add the label key to the EN/EL locale files. No DB/RLS/API changes — `useDealJobs` already returns the ads job with its `details`.

**Tech Stack:** React + TypeScript, i18next (namespace `deals`), Vitest.

## Global Constraints

- Verify frontend with `npm run build` (tsc -b + eslint --max-warnings=0; stricter than `tsc --noEmit`; `noUncheckedIndexedAccess` is on — assert array indices with `!` in tests).
- Commit with pathspec-scoped `git add` + `git commit --only` style (owner may commit in the same tree mid-session; never `git add -A`).
- Push directly to `main` — no PR/feature-branch ceremony.

---

### Task 1: Ads notes block in DealNotesArea

**Files:**
- Modify: `src/features/deals/DealNotesArea.tsx` (helper at lines 13–22, note lookups at lines 34–36, read-only blocks at lines 104–106)
- Modify: `src/i18n/locales/en/deals.json` (inside `"notes_area"`, after `"website_notes"` at line 33)
- Modify: `src/i18n/locales/el/deals.json` (inside `"notes_area"`, after `"website_notes"` at line 33)
- Test: `src/features/deals/DealNotesArea.test.ts` (new)

**Interfaces:**
- Consumes: `noteFrom(jobs: DealJob[], types: string[], key: string): { present: boolean; value: string }` — existing module-local helper in `DealNotesArea.tsx`; this task adds `export` to it. `DealJob = { id: string; service_type: string; details: Record<string, unknown> | null }` from `src/features/deals/hooks/useDealJobs.ts`.
- Produces: nothing consumed by later tasks (single-task plan).

- [ ] **Step 1: Write the failing test**

Create `src/features/deals/DealNotesArea.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { noteFrom } from './DealNotesArea';
import type { DealJob } from './hooks/useDealJobs';

const jobs: DealJob[] = [
  { id: 'j1', service_type: 'ads', details: { ads_notes: 'budget €300/mo, GR targeting' } },
  { id: 'j2', service_type: 'web_dev', details: { webdev_notes: 'wp site' } },
];

describe('noteFrom (ads)', () => {
  it('picks the ads note from an ads job', () => {
    expect(noteFrom(jobs, ['ads'], 'ads_notes')).toEqual({
      present: true,
      value: 'budget €300/mo, GR targeting',
    });
  });

  it('reports absent when the deal has no ads job', () => {
    expect(noteFrom([jobs[1]!], ['ads'], 'ads_notes')).toEqual({ present: false, value: '' });
  });

  it('is present-but-empty when the ads job has no note yet', () => {
    expect(noteFrom([{ id: 'j3', service_type: 'ads', details: null }], ['ads'], 'ads_notes')).toEqual({
      present: true,
      value: '',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/deals/DealNotesArea.test.ts`
Expected: FAIL — `DealNotesArea.tsx` has no exported member `noteFrom` (compile/import error).

- [ ] **Step 3: Implement — export the helper, add the ads block, add the labels**

In `src/features/deals/DealNotesArea.tsx`:

Change line 13 from:

```ts
function noteFrom(
```

to:

```ts
export function noteFrom(
```

After line 36 (`const website = noteFrom(jobs, ['web_dev'], 'webdev_notes');`) add:

```ts
  const ads = noteFrom(jobs, ['ads'], 'ads_notes');
```

After line 106 (`{website.present && readOnlyNote(t('notes_area.website_notes'), website.value)}`) add:

```tsx
      {ads.present && readOnlyNote(t('notes_area.ads_notes'), ads.value)}
```

In `src/i18n/locales/en/deals.json`, change:

```json
    "website_notes": "Website notes",
    "empty": "—"
```

to:

```json
    "website_notes": "Website notes",
    "ads_notes": "Ads notes",
    "empty": "—"
```

In `src/i18n/locales/el/deals.json`, change:

```json
    "website_notes": "Σημειώσεις ιστοσελίδας",
    "empty": "—"
```

to:

```json
    "website_notes": "Σημειώσεις ιστοσελίδας",
    "ads_notes": "Σημειώσεις Ads",
    "empty": "—"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/deals/DealNotesArea.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the full build**

Run: `npm run build`
Expected: completes with zero errors and zero eslint warnings.

- [ ] **Step 6: Commit (pathspec-scoped)**

```bash
git add src/features/deals/DealNotesArea.tsx src/features/deals/DealNotesArea.test.ts src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json docs/superpowers/plans/2026-07-06-ads-notes-in-deal-notes-area.md
git commit -m "feat(deals): show Ads info-tab notes in deal Notes area

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" --only src/features/deals/DealNotesArea.tsx --only src/features/deals/DealNotesArea.test.ts --only src/i18n/locales/en/deals.json --only src/i18n/locales/el/deals.json --only docs/superpowers/plans/2026-07-06-ads-notes-in-deal-notes-area.md
```

## Changes / Revert

- Changes: one commit touching `DealNotesArea.tsx` (+3 lines incl. `export`), new `DealNotesArea.test.ts`, `en/deals.json` (+1 key), `el/deals.json` (+1 key), plus this plan doc.
- Revert: `git revert <commit>`; no data or schema impact.
