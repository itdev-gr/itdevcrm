# Web SEO Kanban — Scoped Search Bar (Design)

**Date:** 2026-06-26
**Status:** Approved (design) — ready for implementation plan
**Scope:** Frontend-only. No DB migration.

## Goal

Add a search bar on the **Web SEO kanban** page (`/tech/web-seo`) that lets the Web
SEO team find any client/job on **their** board. It must **NOT** be a global search:
it only searches the data already on the Web SEO board (web_seo jobs + the ai_seo
parent + AI-SEO web children that surface there).

The box is a single "smart" search that matches across all of:

- **Web SEO ID** — `jobs.code` for a `web_seo` job (e.g. `000013-WEBSEO`)
- **AI Web SEO ID** — `jobs.code` for the AI-SEO web child (e.g. `000013-AISEOWEB`)
- **Client ID** — `clients.code`
- **Name** — `clients.name` + contact first/last name
- **Email** — `clients.email`
- **Phone** — `clients.phone` / `clients.phone_normalized` (digits-only compare)
- **Website** — `clients.website`
- Also: `jobs.title`, `deals.code`

## Chosen approach

**Client-side filter of the already-loaded board data.**

The board already fetches **all** of its jobs client-side via `useJobs('web_seo')`
(`src/features/jobs/hooks/useJobs.ts`) — service types `['web_seo', 'ai_seo']`,
`archived = false`, no pagination. So we filter that in-memory set and render a
results dropdown. No new RPC, no migration; the search is instant and is naturally
RLS-scoped (it can only ever see rows the user is already allowed to load).

The only data work: the current `useJobs` select pulls `client(id, name,
contact_first_name, contact_last_name, industry)` — it does **not** include
email/phone/website/client-code. We expand the sub-select so those fields are
available to search.

Alternatives rejected:

- **Server-side `web_seo_search(q)` RPC** — a board-scoped clone of `global_search`.
  Overkill: the board already holds every row in memory, so an RPC only adds a
  migration + security-definer maintenance for no benefit at this data size.
- **Reuse `global_search`, filter to web_seo** — it is cross-entity and global by
  design; the requirement is explicitly *not* global.

## Architecture / components

Three small, independently-testable units:

### 1. `src/features/jobs/search/webSeoSearchMatch.ts` (pure logic)

```ts
export function searchJobs(jobs: JobRow[], query: string): JobRow[]
```

- Pure, no React, no Supabase → unit-tested with TDD.
- Returns `[]` for an empty/whitespace/`< 2 char` query.
- Case-insensitive substring match. For phone, strip all non-digits from both the
  query and `phone`/`phone_normalized` before comparing (so `69 12 34` matches
  `6912 34...`); only attempt phone matching when the query contains digits.
- **Fields matched per job:** `job.code`, `job.title`, `deal.code`, `client.code`,
  `client.name`, `client.contact_first_name + ' ' + contact_last_name`,
  `client.email`, `client.website`, `client.phone`, `client.phone_normalized`.
- **Ranking:** code prefix-match first (job.code / client.code / deal.code that
  *starts with* the query), then any other match, stable thereafter. Cap at 15
  results.

### 2. `src/features/jobs/search/WebSeoSearch.tsx` (presentational)

- Props: `{ jobs: JobRow[] }` — the full board set the user can see.
- Local state: query string, debounced query (250 ms), open/closed, active index.
- Calls `searchJobs(jobs, debounced)`; renders a dropdown of `<Link to="/jobs/:id">`
  rows, styled to match `src/features/search/GlobalSearch.tsx`.
- Keyboard nav (↑ / ↓ / Enter / Esc) and click-outside-to-close, mirroring
  `GlobalSearch`.
- Each result row: mono **code** badge · **client name** · **stage label** · an
  **"AI SEO"** tag when `job.parent_job_id` is set.
- Bilingual placeholder / empty-state text (el / en) following the page's existing
  `lang` pattern.

### 3. Wire-up in `src/features/jobs/JobsKanbanPage.tsx`

- Render `<WebSeoSearch jobs={jobs} />` in the `PageHeader` children area, next to
  the existing Only-mine / Admin badge.
- **Gate to `serviceType === 'web_seo'`** so it appears only on the Web SEO board.
  (Trivially extendable to other boards later by removing the gate.)
- Pass the **full** `jobs` array (pre-`onlyMine` filter) so search covers "all the
  clients in their kanban" regardless of the Only-mine toggle state.

### 4. Data change — `useJobs` select + `JobRow` type

Expand the client sub-select in `useJobs`:

```ts
client:clients(id, code, name, contact_first_name, contact_last_name,
               email, phone, phone_normalized, website, industry)
```

Add `code: string | null`, `website?: string | null`, `phone_normalized?: string |
null` to the `client` shape in the `JobRow` type. (`email`/`phone` are already
declared optional on the type.) RLS is row-level: the technical team already loads
these client rows for the board, so selecting more columns of the same row is free
and requires no policy change.

## Data flow

```
useJobs('web_seo')  ──>  jobs: JobRow[]  ──┬─>  groupJobsForBoard ──> columns (unchanged)
                                           └─>  <WebSeoSearch jobs={jobs} />
                                                     │ debounce(query)
                                                     ▼
                                                searchJobs(jobs, q) ──> ranked rows
                                                     │ click / Enter
                                                     ▼
                                                Link to /jobs/:id
```

## Error handling / edge cases

- Empty / `< 2 char` query → no dropdown results (show "type to search" hint).
- No matches → "no results" message in the dropdown.
- Missing optional fields (null email/phone/website/code) → simply not matched; no
  crash.
- A client with multiple jobs on the board (e.g. a web_seo job **and** an AI-SEO web
  child) yields one result row **per job** — that is intended (each is a distinct
  card / code).
- Phone formatting differences handled by digits-only comparison.

## Testing

TDD on `webSeoSearchMatch.searchJobs` (Vitest), covering:

- match by `job.code` (Web SEO ID) and by AI-SEO child code (`…-AISEOWEB`)
- match by `client.code` (Client ID), `deal.code`
- match by client name and by contact first/last name
- match by email, by website
- match by phone with formatting differences (spaces, dashes) via digits-only compare
- case-insensitivity
- empty / whitespace / 1-char query → `[]`
- ranking: a code prefix-match sorts before a mid-string name match
- result cap (≤ 15)

Frontend build must pass `npm run build` (stricter than `tsc --noEmit`:
`noUncheckedIndexedAccess` + `eslint --max-warnings=0`).

## Changes / Revert

Frontend-only; **no migration**.

Files added/changed:

- `src/features/jobs/search/webSeoSearchMatch.ts` (new)
- `src/features/jobs/search/webSeoSearchMatch.test.ts` (new)
- `src/features/jobs/search/WebSeoSearch.tsx` (new)
- `src/features/jobs/JobsKanbanPage.tsx` (mount the search, gated to web_seo)
- `src/features/jobs/hooks/useJobs.ts` (expand client sub-select + `JobRow` type)

Revert: revert the above commits. No DB state to roll back.

## Out of scope (YAGNI)

- Structured per-field filter dropdowns (stage/owner) — the box already covers it.
- Filtering the kanban columns in place (user chose the dropdown-results behavior).
- Enabling the search on other boards (gate makes it web_seo-only for now).
- A server-side RPC.
