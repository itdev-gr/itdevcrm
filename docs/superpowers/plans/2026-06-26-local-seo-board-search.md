# Local SEO Board Search Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a board-scoped search box to the Local SEO kanban (`/tech/local-seo`) that filters the cards in memory by job name, job code, deal/account code, client name, client email, client phone, and the job's `profile_url` / `business_profile` — never touching the global search.

**Architecture:** The Local SEO board (`JobsKanbanPage` with `serviceType="local_seo"`) loads all its jobs at once via `useJobs('local_seo')`, so this is a pure client-side filter: widen the `useJobs` client sub-select to include email+phone, add a pure `matchesJobSearch(job, query)` matcher, and filter the jobs in `JobsKanbanPage` before grouping them into columns. No migration, no RPC.

**Tech Stack:** React + TypeScript (strict: `noUncheckedIndexedAccess`, eslint `--max-warnings=0`), @tanstack/react-query, supabase-js, vitest. Verify frontend with `npm run build` (stricter than `tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-06-26-local-seo-board-search-design.md`

**Note on i18n:** `JobsKanbanPage.tsx` does NOT use `t()`; it picks EN/EL via a `lang` ternary + the `SERVICE_LABELS` constant. To match the file's existing pattern (write code that reads like its surroundings), the search placeholder uses the same bilingual-constant pattern, NOT `common.json`. This is a deliberate, noted deviation from the spec's "i18n common.json" line.

---

## File Structure

**Created:**
- `src/features/jobs/jobSearch.ts` — pure `matchesJobSearch` + `jobSearchHaystack`.
- `src/features/jobs/jobSearch.test.ts` — unit tests for the matcher.

**Modified:**
- `src/features/jobs/hooks/useJobs.ts` — add `email, phone` to the client sub-select.
- `src/features/jobs/JobsKanbanPage.tsx` — search state + input (Local SEO only) + filter before grouping.

---

## Task 1: Widen the `useJobs` client sub-select

The matcher needs `client.email` and `client.phone`, which the board query doesn't currently fetch. `JobRow.client` already types them as optional, so this only populates existing optional fields (harmless for the web_seo/web_dev/etc. boards that share `useJobs`).

**Files:**
- Modify: `src/features/jobs/hooks/useJobs.ts:47`

- [ ] **Step 1: Add `email, phone` to the client select**

In `src/features/jobs/hooks/useJobs.ts`, change the `.select(...)` string's client join from:

```ts
        .select(
          '*, parent_job_id, client:clients(id, name, contact_first_name, contact_last_name, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
```

to (adds `, email, phone` inside the `client:clients(...)` group):

```ts
        .select(
          '*, parent_job_id, client:clients(id, name, contact_first_name, contact_last_name, industry, email, phone), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type changes — `email`/`phone` were already optional on `JobRow.client`).

- [ ] **Step 3: Commit**

```bash
git add src/features/jobs/hooks/useJobs.ts
git commit -m "feat(jobs): load client email+phone for board search"
```

---

## Task 2: Pure `matchesJobSearch` matcher (TDD)

**Files:**
- Create: `src/features/jobs/jobSearch.ts`
- Test: `src/features/jobs/jobSearch.test.ts`

- [ ] **Step 1: Write the failing test** `src/features/jobs/jobSearch.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { matchesJobSearch } from './jobSearch';
import type { JobRow } from './hooks/useJobs';

// The matcher only reads a handful of fields, so a partial object is enough.
function job(partial: Partial<JobRow> & { details?: Record<string, unknown> | null }): JobRow {
  return partial as unknown as JobRow;
}

const full = job({
  title: 'GBP optimisation',
  code: '000013-LOCALSEO',
  deal: { id: 'd1', code: '000013', title: null },
  client: {
    id: 'c1', name: 'Ortho House', contact_first_name: null, contact_last_name: null,
    industry: null, email: 'hello@orthohouse.gr', phone: '2101234567',
  },
  details: { profile_url: 'https://maps.google.com/orthohouse', business_profile: 'Ortho House Athens' },
});

describe('matchesJobSearch', () => {
  it('empty / whitespace query matches every job', () => {
    expect(matchesJobSearch(full, '')).toBe(true);
    expect(matchesJobSearch(full, '   ')).toBe(true);
  });

  it('matches the job title', () => {
    expect(matchesJobSearch(full, 'optimis')).toBe(true);
  });

  it('matches the job code (JOB ID)', () => {
    expect(matchesJobSearch(full, '000013-localseo')).toBe(true);
  });

  it('matches the deal/account code (clientID)', () => {
    expect(matchesJobSearch(full, '000013')).toBe(true);
  });

  it('matches the client name', () => {
    expect(matchesJobSearch(full, 'ortho house')).toBe(true);
  });

  it('matches the client email', () => {
    expect(matchesJobSearch(full, 'orthohouse.gr')).toBe(true);
  });

  it('matches the client phone', () => {
    expect(matchesJobSearch(full, '2101234567')).toBe(true);
  });

  it('matches the details.profile_url', () => {
    expect(matchesJobSearch(full, 'maps.google.com/orthohouse')).toBe(true);
  });

  it('matches the details.business_profile', () => {
    expect(matchesJobSearch(full, 'athens')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesJobSearch(full, 'ORTHO HOUSE')).toBe(true);
  });

  it('returns false for a non-matching query', () => {
    expect(matchesJobSearch(full, 'zzz-no-such-thing')).toBe(false);
  });

  it('does not throw when client/deal/details are null', () => {
    const bare = job({ title: 'bare', code: null, deal: null, client: null, details: null });
    expect(matchesJobSearch(bare, 'bare')).toBe(true);
    expect(matchesJobSearch(bare, 'ortho')).toBe(false);
  });

  it('does not false-positive across field boundaries', () => {
    // "house2101" would only match if name+phone were concatenated without a separator.
    expect(matchesJobSearch(full, 'house2101')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './jobSearch'`)

Run: `npx vitest run src/features/jobs/jobSearch.test.ts`

- [ ] **Step 3: Implement** `src/features/jobs/jobSearch.ts`

```ts
import type { JobRow } from './hooks/useJobs';

/** Coerce an unknown value to a string ('' for null/undefined/non-string). */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** All searchable fields of a Local SEO job, lowercased and joined with a
 *  separator so a query can't match across two adjacent fields. */
export function jobSearchHaystack(job: JobRow): string {
  const d: Record<string, unknown> = job.details ?? {};
  return [
    job.title,
    job.code,
    job.deal?.code,
    job.client?.name,
    job.client?.email,
    job.client?.phone,
    d.profile_url,
    d.business_profile,
  ]
    .map(str)
    .join('\n')
    .toLowerCase();
}

/** Case-insensitive substring match across all searchable fields.
 *  An empty/whitespace query matches every job (no filtering). */
export function matchesJobSearch(job: JobRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return jobSearchHaystack(job).includes(q);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/features/jobs/jobSearch.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/jobSearch.ts src/features/jobs/jobSearch.test.ts
git commit -m "feat(jobs): pure matchesJobSearch matcher + tests"
```

---

## Task 3: Wire the search box into the Local SEO board

**Files:**
- Modify: `src/features/jobs/JobsKanbanPage.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/features/jobs/JobsKanbanPage.tsx`, add the `Input` and matcher imports next to the existing imports:

```ts
import { Input } from '@/components/ui/input';
import { matchesJobSearch } from './jobSearch';
```

- [ ] **Step 2: Add a bilingual placeholder constant**

Right after the `SERVICE_LABELS` constant (around line 34), add:

```ts
const SEARCH_PLACEHOLDER: { en: string; el: string } = {
  en: 'Search this board…',
  el: 'Αναζήτηση σε αυτόν τον πίνακα…',
};
```

- [ ] **Step 3: Add search state**

Inside the component, next to the other `useState` calls (around line 40), add:

```ts
  const [search, setSearch] = useState('');
```

- [ ] **Step 4: Apply the filter before grouping**

Replace the existing `filteredJobs` definition (lines 61-62):

```ts
  const filteredJobs =
    onlyMine && userId ? jobs.filter((j) => j.owner_user_id === userId) : jobs;
```

with (compose the scope filter, then the search filter):

```ts
  const scopedJobs =
    onlyMine && userId ? jobs.filter((j) => j.owner_user_id === userId) : jobs;
  const filteredJobs = scopedJobs.filter((j) => matchesJobSearch(j, search));
```

(`filteredJobs` is what feeds `groupJobsForBoard` and the header count, so columns + counts reflect the matches.)

- [ ] **Step 5: Render the search input (Local SEO only)**

In the `<PageHeader …>` children, add the search input BEFORE the `{isAdmin ? … : …}` block. `PageHeader` already wraps its children in a `flex flex-wrap items-center gap-2` row, so the input and the scope chip sit side by side. Change:

```tsx
      <PageHeader title={SERVICE_LABELS[serviceType][lang]}>
        {isAdmin ? (
```

to:

```tsx
      <PageHeader title={SERVICE_LABELS[serviceType][lang]}>
        {serviceType === 'local_seo' && (
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[lang]}
            aria-label={SEARCH_PLACEHOLDER[lang]}
            className="h-9 w-48 rounded-lg border-input/80 shadow-sm sm:w-64"
          />
        )}
        {isAdmin ? (
```

(The existing closing `)}` of the `{isAdmin ? … : …}` ternary and `</PageHeader>` stay as-is.)

- [ ] **Step 6: Typecheck + build (lint gate)**

Run: `npm run build`
Expected: tsc PASS, eslint 0 warnings, vite build OK. (The chunk-size note is pre-existing and informational.)

- [ ] **Step 7: Commit**

```bash
git add src/features/jobs/JobsKanbanPage.tsx
git commit -m "feat(local-seo): board search box filters cards by client/job info"
```

---

## Task 4: Full verification, live smoke, push

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm run build && npm run test:run`
Expected: build green, all vitest tests pass (including the new `jobSearch.test.ts`).

- [ ] **Step 2: Push to main**

```bash
git push origin HEAD:main
```
(Project convention: push directly to main, no PR. If a parallel session has advanced origin, `git fetch origin && git pull --rebase origin main` first, then push.)

- [ ] **Step 3: Live Playwright smoke on the deployed Local SEO board**

After Vercel redeploys (confirm the served `index-*.js` chunk hash changed before testing — stale-chunk caching is common right after deploy):
1. Navigate to `https://www.itdevcrm.com/tech/local-seo`, signed in as an admin (info@itdev.gr).
2. Confirm a search box appears in the board header (and confirm it does NOT appear on `/tech/web-dev`).
3. Type a known client's deal code (e.g. an `000xxx` visible on a card) → assert the board narrows to that client's card(s) and other columns empty out.
4. Type a fragment of a client name → assert matching card(s) remain.
5. Clear the box → assert all cards return.
6. Check `browser_console_messages` level=error → expect 0 errors.

---

## Self-Review (run before execution)

- **Spec coverage:** profile_url + business_profile (haystack, Task 2) ✅; job name = title (Task 2) ✅; email + phone (query widen Task 1 + haystack Task 2) ✅; clientID = deal.code (Task 2) ✅; JOB ID = job.code (Task 2) ✅; board-scoped client-side filter, not global (Task 3 filters in-memory board jobs only) ✅; Local SEO only (Task 3 `serviceType === 'local_seo'` gate) ✅; case-insensitive substring + empty=all (Task 2) ✅; tests + build + live smoke (Tasks 2/4) ✅.
- **Deviation noted:** placeholder uses the file's bilingual-constant pattern, not `common.json` (matches `JobsKanbanPage`'s existing non-`t()` style).
- **Type consistency:** `matchesJobSearch(job: JobRow, query: string): boolean` and `jobSearchHaystack(job: JobRow): string` are referenced identically in Task 2 (impl + test) and Task 3 (import + call). `JobRow` imported from `./hooks/useJobs` in both new files.
- **No placeholders:** every code step has complete code.
