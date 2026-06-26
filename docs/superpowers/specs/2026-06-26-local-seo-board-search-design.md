# Local SEO board search filter

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Problem

Local SEO staff work the `/tech/local-seo` kanban board (`JobsKanbanPage` with
`serviceType="local_seo"`). They have no way to quickly find a specific client/job
on that board. They want a search box that matches the information a local-SEO job
carries — its Google business **profile URL** / business profile, the **job name**,
the client's **email** and **phone**, the **deal/account code** (e.g. `000013`), and
the **job code** (e.g. `000013-LOCALSEO`).

The search must be **scoped to the Local SEO board only** — it filters the cards
already on that board and must NOT invoke the global top-bar search
(`global_search` RPC) or surface anything outside Local SEO.

## Scope & decisions (confirmed with product owner)

- **Client-side filter, no server work.** The Local SEO board loads *all* its jobs
  into memory at once (`useJobs('local_seo')` is not paginated), so filtering happens
  client-side over the already-loaded jobs. This is instant, needs no RPC/RLS changes,
  and is inherently board-scoped. A server-side `local_seo_search` RPC was considered
  and rejected as over-engineering (no pagination to work around).
- **"clientID" = the deal/account code** (`000013`), already loaded as `deal.code`.
  (NOT the internal `clients.code` `L-000001`.)
- **"JOB ID" = the job code** (`jobs.code`, e.g. `000013-LOCALSEO`).
- **Scoped to the Local SEO board** as requested. The matcher + input are written so
  they could be enabled on other tech boards later, but only Local SEO renders the
  input in v1.
- Search is **case-insensitive substring**, single box, **OR across all fields**.
  Empty query = no filtering (all jobs shown).

## Searchable fields (8) and where they live

| Field | Source | Already loaded? |
|---|---|---|
| Profile URL | `job.details.profile_url` (JSONB) | ✅ (`useJobs` selects `*`) |
| Business profile | `job.details.business_profile` (JSONB) | ✅ |
| Job name | `job.title` | ✅ |
| Job code (JOB ID) | `job.code` | ✅ |
| Deal/account code (clientID) | `job.deal.code` | ✅ |
| Client name | `job.client.name` | ✅ |
| Client email | `job.client.email` | ❌ — add to query |
| Client phone | `job.client.phone` | ❌ — add to query |

## Data model

No migration. One query change:

`src/features/jobs/hooks/useJobs.ts` — extend the client sub-select from
`client:clients(id, name, contact_first_name, contact_last_name, industry)` to also
include `email, phone`. `JobRow.client` already types `email?` and `phone?` as
optional, so this only populates existing optional fields (harmless for the other
boards that share `useJobs`). All other fields are already selected via `*` / the
existing `deal` join.

## Components / data flow

### New: `src/features/jobs/jobSearch.ts` (pure, unit-tested)

```ts
import type { JobRow } from './hooks/useJobs';

/** Normalize a job's searchable fields into one lowercase haystack. */
export function jobSearchHaystack(job: JobRow): string { ... }

/** Case-insensitive substring match across all searchable fields.
 *  Empty/whitespace query → true (no filtering). */
export function matchesJobSearch(job: JobRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return jobSearchHaystack(job).includes(q);
}
```

Haystack fields: `title`, `code`, `deal?.code`, `client?.name`,
`client?.email`, `client?.phone`, `details?.profile_url`,
`details?.business_profile` — each coerced to string, lowercased, joined with a
separator. Non-string `details` values are guarded (read via a small `str()` helper
that returns '' for null/undefined/non-string).

### Changed: `src/features/jobs/JobsKanbanPage.tsx`

- Add `const [search, setSearch] = useState('')`.
- Render a search `<Input type="search">` in the board toolbar **only when
  `serviceType === 'local_seo'`** (matches the request; keeps other boards unchanged).
- Apply the filter to the jobs list BEFORE `groupJobsForBoard(...)`, composed with the
  existing `onlyMine` filter:
  `const visible = (onlyMine && userId ? jobs.filter(j => j.owner_user_id === userId) : jobs).filter(j => matchesJobSearch(j, search));`
  so columns and their counts reflect the matches.
- The existing empty-column message ("Nothing here.") already covers the no-matches
  case per column; no separate empty state needed.

### i18n

`common.json` (en + el): a placeholder string, e.g.
`jobs_board.search_placeholder` → EN "Search this board…" / EL "Αναζήτηση σε αυτόν τον πίνακα…".

## Testing

- **Unit** (`jobSearch.test.ts`): each of the 8 fields matches when present;
  case-insensitive; empty query returns true for any job; a non-matching query returns
  false; null `details`/`client`/`deal` don't throw; a query matching one field doesn't
  false-positive on an unrelated job.
- `npm run build` green (tsc strict + eslint `--max-warnings=0`).
- **Playwright smoke** on the deployed `/tech/local-seo`: type a known client's code /
  name / profile URL fragment and confirm the board narrows to the matching card(s);
  clear the box and confirm all cards return. 0 console errors.

## Changes / Revert

**Changes**
- `useJobs.ts`: add `email, phone` to the client sub-select.
- New `jobSearch.ts` + `jobSearch.test.ts`.
- `JobsKanbanPage.tsx`: search state + input (local_seo only) + filter before grouping.
- i18n placeholder (en + el).

**Revert**
- `git revert` the feature commits (frontend-only, no migration, no data change). The
  `useJobs` select change is additive and safe to roll back.

## Out of scope (YAGNI)

- Server-side search RPC.
- Enabling the search on other tech boards (web_seo/web_dev/etc.).
- Highlighting matched substrings, filters beyond free-text, search history.
- Searching the internal `clients.code` (L-000001) — confirmed not wanted.
