# Web SEO Kanban — Search Bar (Design)

**Date:** 2026-06-26
**Status:** Approved (design) — ready for implementation plan
**Scope:** Frontend-only. No DB migration.

## Goal

Give the **Web SEO kanban** (`/tech/web-seo`) the same search box that the **Local
SEO** board already has, with searchable fields that fit Web SEO. It must **NOT** be
a global search: it only filters the data already on the board (web_seo jobs + the
ai_seo parent + AI-SEO web children that surface there).

Searchable "Web SEO criteria":

- **Web SEO ID** — `jobs.code` for a `web_seo` job (e.g. `000013-WEBSEO`)
- **AI Web SEO ID** — `jobs.code` for the AI-SEO web child (e.g. `000013-AISEOWEB`)
- **Client ID** — `clients.code`
- **Name** — `clients.name` + contact first/last name
- **Email** — `clients.email`
- **Phone** — `clients.phone` / `clients.phone_normalized`
- **Website** — `clients.website`
- Also already covered: `jobs.title`, `deals.code`

## Chosen approach — reuse the Local SEO search

The board already has a working, tested **filter-in-place** search (commit
`3dea48c`), currently gated to `serviceType === 'local_seo'`:

- UI: an inline `<Input type="search">` in the `PageHeader` of
  `src/features/jobs/JobsKanbanPage.tsx` bound to a `search` state.
- Logic: `matchesJobSearch(job, query)` / `jobSearchHaystack(job)` in
  `src/features/jobs/jobSearch.ts` (pure, unit-tested in `jobSearch.test.ts`).
- Effect: `scopedJobs.filter((j) => matchesJobSearch(j, search))` → the kanban
  columns shrink to matching cards; an empty query shows everything.

We **reuse all of it** for Web SEO. Three small changes:

1. **Enable the box on Web SEO** — widen the render gate from
   `serviceType === 'local_seo'` to also include `'web_seo'`.
2. **Enrich the shared matcher** — `jobSearchHaystack` currently covers
   `title, code, deal.code, client.name, client.email, client.phone,
   details.profile_url, details.business_profile`. Add the missing Web SEO
   criteria: `client.code`, contact first/last name, `client.website`,
   `client.phone_normalized`. The matcher is shared, so Local SEO gains these too
   (a free, consistent improvement). The board never matches sensitive job-detail
   fields (e.g. the web_seo `website_password`).
3. **Expand the data load** — the `useJobs` client sub-select must include the new
   columns so they are present to search.

Rejected: building a separate dropdown / new search components — the user chose to
reuse the existing Local SEO pattern for consistency and minimal code.

## Data change — `useJobs` select + `JobRow` type

`src/features/jobs/hooks/useJobs.ts`:

- Expand the client sub-select to:
  ```
  client:clients(id, code, name, contact_first_name, contact_last_name,
                 email, phone, phone_normalized, website, industry)
  ```
- Add to the `JobRow.client` type: `code?: string | null`,
  `phone_normalized?: string | null`, `website?: string | null`.
  (`email?` / `phone?` are already declared; contact names already selected.)

RLS is row-level: the technical team already loads these client rows for the board,
so selecting more columns of the same row is free and needs no policy change.

## Matcher change — `jobSearch.ts`

`jobSearchHaystack(job)` adds these to the joined, lowercased haystack (each on its
own line so a query can't match across field boundaries):

- `job.client?.code`
- `job.client?.contact_first_name` + `job.client?.contact_last_name`
- `job.client?.website`
- `job.client?.phone_normalized`

`matchesJobSearch` is unchanged (empty/whitespace query still matches every job →
no filtering).

## UI change — `JobsKanbanPage.tsx`

The search `<Input>` render gate changes from:

```tsx
{serviceType === 'local_seo' && ( … )}
```

to:

```tsx
{(serviceType === 'local_seo' || serviceType === 'web_seo') && ( … )}
```

No other UI change. The box keeps its existing placeholder (`Search this board…` /
`Αναζήτηση σε αυτόν τον πίνακα…`), styling, and position next to the
Only-mine / Admin badge. It filters `scopedJobs` (post Only-mine), matching the
existing Local SEO behavior exactly.

## Data flow (unchanged shape)

```
useJobs(serviceType) ─> jobs ─> scopedJobs (Only-mine) ─> filter(matchesJobSearch(j, search))
                                                              ─> groupJobsForBoard ─> columns
```

## Error handling / edge cases

- Empty / whitespace query → no filtering (all cards shown). Existing behavior.
- Missing optional fields (null code/website/phone_normalized/contact) → not
  matched; no crash (haystack coerces null → '').
- AI-SEO web child and ai_seo parent are in the loaded set; their codes match via
  `job.code`.
- Phone formatting differences: a digits-only query matches `phone_normalized`.

## Testing

Extend `src/features/jobs/jobSearch.test.ts` (Vitest, TDD), adding cases:

- matches `client.code` (Client ID)
- matches contact first/last name
- matches `client.website`
- matches `client.phone_normalized` when `client.phone` is stored with formatting
- existing tests stay green

Then `npm run build` (stricter than `tsc --noEmit`: `noUncheckedIndexedAccess` +
`eslint --max-warnings=0`) and `npm run test:run`.

## Changes / Revert

Frontend-only; **no migration**.

Files changed:

- `src/features/jobs/jobSearch.ts` (enrich haystack)
- `src/features/jobs/jobSearch.test.ts` (new cases)
- `src/features/jobs/hooks/useJobs.ts` (expand client sub-select + `JobRow` type)
- `src/features/jobs/JobsKanbanPage.tsx` (widen search-box gate to web_seo)

Revert: revert the above commits. No DB state to roll back.

## Out of scope (YAGNI)

- A dropdown results list (user chose to reuse the filter-in-place box).
- Searching sensitive job-detail fields (creds/passwords).
- Enabling the box on non-SEO boards (web_dev/social/hosting/ads stay without it).
- Any server-side RPC.
