# Web SEO Kanban Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Web SEO kanban (`/tech/web-seo`) the same filter-in-place search box that Local SEO already has, with searchable fields fit for Web SEO.

**Architecture:** Reuse the existing Local SEO search end-to-end. (1) Expand the `useJobs` client sub-select so the new fields load. (2) Enrich the shared, pure `jobSearchHaystack` matcher with the Web SEO criteria (client code, contact name, website, normalized phone). (3) Widen the search-box render gate in `JobsKanbanPage` to also show on `web_seo`. No new components, no DB migration.

**Tech Stack:** React + TypeScript (Vite), TanStack Query, Supabase JS, Vitest, Tailwind/shadcn `Input`.

---

## File structure

- `src/features/jobs/hooks/useJobs.ts` — modify: `JobRow.client` type + the `clients(...)` sub-select.
- `src/features/jobs/jobSearch.ts` — modify: `jobSearchHaystack` (add 4 fields).
- `src/features/jobs/jobSearch.test.ts` — modify: enrich fixture + add 4 test cases.
- `src/features/jobs/JobsKanbanPage.tsx` — modify: search-box render gate (line ~117).

Reference (read-only, do not change): `src/features/search/GlobalSearch.tsx` (the *global* search — intentionally NOT reused).

---

## Task 1: Load the new client fields (useJobs select + type)

**Why first:** the matcher (Task 2) reads `client.code`, `client.website`, `client.phone_normalized`; they must be selected and typed or the build fails / they're always empty.

**Files:**
- Modify: `src/features/jobs/hooks/useJobs.ts:10-28` (`JobRow.client` type)
- Modify: `src/features/jobs/hooks/useJobs.ts:46-48` (the `.select(...)` string)

- [ ] **Step 1: Add the new fields to the `JobRow.client` type**

In `src/features/jobs/hooks/useJobs.ts`, the `client` object inside `JobRow` currently is:

```ts
  client?: {
    id: string;
    name: string;
    contact_first_name: string | null;
    contact_last_name: string | null;
    industry: string | null;
    email?: string | null;
    phone?: string | null;
    contact_info?: string | null;
    additional_contacts?:
      | { full_name?: string | null; email?: string | null; phone?: string | null; info?: string | null }[]
      | null;
  } | null;
```

Add three optional fields (`code`, `phone_normalized`, `website`) so it becomes:

```ts
  client?: {
    id: string;
    name: string;
    code?: string | null;
    contact_first_name: string | null;
    contact_last_name: string | null;
    industry: string | null;
    email?: string | null;
    phone?: string | null;
    phone_normalized?: string | null;
    website?: string | null;
    contact_info?: string | null;
    additional_contacts?:
      | { full_name?: string | null; email?: string | null; phone?: string | null; info?: string | null }[]
      | null;
  } | null;
```

- [ ] **Step 2: Expand the `clients(...)` sub-select**

In the same file, the query is:

```ts
        .select(
          '*, parent_job_id, client:clients(id, name, contact_first_name, contact_last_name, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
```

Change only the `client:clients(...)` part to include `code, email, phone, phone_normalized, website`:

```ts
        .select(
          '*, parent_job_id, client:clients(id, code, name, contact_first_name, contact_last_name, email, phone, phone_normalized, website, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
```

- [ ] **Step 3: Verify the build (type check)**

Run: `npm run build`
Expected: PASS (no TypeScript or eslint errors). There is no unit test for a Supabase select; the type check is the verification.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/hooks/useJobs.ts
git commit -m "feat(jobs): load client code/website/phone_normalized for board search

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Enrich the shared matcher (TDD)

**Files:**
- Modify (test first): `src/features/jobs/jobSearch.test.ts`
- Modify: `src/features/jobs/jobSearch.ts:10-25` (`jobSearchHaystack`)

- [ ] **Step 1: Update the test fixture and add failing tests**

In `src/features/jobs/jobSearch.test.ts`, replace the `full` fixture so the client has the new fields and a *formatted* phone (with a separate normalized value), and contact names:

```ts
const full = job({
  title: 'GBP optimisation',
  code: '000013-WEBSEO',
  deal: { id: 'd1', code: '000013', title: null },
  client: {
    id: 'c1',
    name: 'Ortho House',
    code: 'CL-000013',
    contact_first_name: 'Maria',
    contact_last_name: 'Papadopoulou',
    industry: null,
    email: 'hello@orthohouse.gr',
    phone: '210 123 4567',
    phone_normalized: '2101234567',
    website: 'https://orthohouse.gr',
  },
  details: { profile_url: 'https://maps.google.com/orthohouse', business_profile: 'Ortho House Athens' },
});
```

Then add these four `it(...)` cases inside the `describe('matchesJobSearch', ...)` block:

```ts
  it('matches the client code (Client ID)', () => {
    expect(matchesJobSearch(full, 'cl-000013')).toBe(true);
  });

  it('matches the contact first/last name', () => {
    expect(matchesJobSearch(full, 'maria papad')).toBe(true);
  });

  it('matches the client website', () => {
    expect(matchesJobSearch(full, 'orthohouse.gr')).toBe(true);
  });

  it('matches a digits-only phone query via phone_normalized', () => {
    // client.phone is stored with spaces; the digits-only query must still match.
    expect(matchesJobSearch(full, '2101234567')).toBe(true);
  });
```

Note: the existing `it('matches the client phone', ...)` case (query `'2101234567'`) now also relies on `phone_normalized` because the fixture's `phone` gained spaces — it must stay green after Step 3.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/features/jobs/jobSearch.test.ts`
Expected: FAIL — the new cases (client code, contact name, website, normalized phone) and the existing `matches the client phone` case fail, because `jobSearchHaystack` does not yet include those fields.

- [ ] **Step 3: Enrich `jobSearchHaystack`**

In `src/features/jobs/jobSearch.ts`, replace the `jobSearchHaystack` function. Update the doc comment (it serves all SEO boards now, not just Local SEO) and add the four client fields:

```ts
/** All searchable fields of an SEO-board job (Local SEO + Web SEO), lowercased
 *  and joined with a separator so a query can't match across two adjacent
 *  fields. */
export function jobSearchHaystack(job: JobRow): string {
  const d: Record<string, unknown> = job.details ?? {};
  return [
    job.title,
    job.code,
    job.deal?.code,
    job.client?.code,
    job.client?.name,
    job.client?.contact_first_name,
    job.client?.contact_last_name,
    job.client?.email,
    job.client?.phone,
    job.client?.phone_normalized,
    job.client?.website,
    d.profile_url,
    d.business_profile,
  ]
    .map(str)
    .join('\n')
    .toLowerCase();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/features/jobs/jobSearch.test.ts`
Expected: PASS — all cases green, including the unchanged boundary test (`'house2101'` → false) and `'maps.google.com/orthohouse'`.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/jobSearch.ts src/features/jobs/jobSearch.test.ts
git commit -m "feat(jobs): search client code/name/website/phone in board matcher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Show the search box on the Web SEO board

**Files:**
- Modify: `src/features/jobs/JobsKanbanPage.tsx:117` (the search `<Input>` render gate)

- [ ] **Step 1: Widen the render gate**

In `src/features/jobs/JobsKanbanPage.tsx`, the search input is currently gated:

```tsx
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
```

Change only the condition so it also shows on Web SEO:

```tsx
        {(serviceType === 'local_seo' || serviceType === 'web_seo') && (
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[lang]}
            aria-label={SEARCH_PLACEHOLDER[lang]}
            className="h-9 w-48 rounded-lg border-input/80 shadow-sm sm:w-64"
          />
        )}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (describe, do not automate)**

Start the app (`npm run dev`), open `/tech/web-seo`, and confirm:
- the search box appears in the header next to the Only-mine / Admin badge;
- typing a job code, client name, Client ID, email, phone (digits), or website narrows the columns to matching cards;
- clearing the box restores all cards;
- `/tech/local-seo` still shows and uses its search (unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobsKanbanPage.tsx
git commit -m "feat(web-seo): enable board search box on the Web SEO kanban

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full test suite: `npm run test:run` → all green.
- [ ] Run the build: `npm run build` → PASS (tsc + eslint `--max-warnings=0`).
- [ ] Confirm the diff touches only the four files in the file-structure list.

---

## Self-review notes

- **Spec coverage:** Web SEO ID + AI Web SEO ID → `job.code` (Task 2 haystack, already present); Client ID → `client.code` (Task 1 select + Task 2 haystack + test); name → `client.name` + contact names (Task 2); email/phone/website → covered (Task 1 select + Task 2 haystack + tests); enable on Web SEO → Task 3. All spec sections map to a task.
- **No sensitive fields:** the haystack adds only client-level fields; web_seo `website_password` (a job-detail cred) is never searched.
- **Type consistency:** `client.code`, `client.phone_normalized`, `client.website` are added to the `JobRow.client` type (Task 1) and read with optional chaining + `str()` coercion in the haystack (Task 2); the test fixture provides all of them.
- **Behavior parity:** Task 3 changes only the render condition; the filter logic (`scopedJobs.filter((j) => matchesJobSearch(j, search))`) and empty-query = no-filter semantics are unchanged and shared with Local SEO.
