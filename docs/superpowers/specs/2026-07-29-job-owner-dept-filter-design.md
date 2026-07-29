# Department-filtered Assigned (Owner) dropdown on jobs

**Date:** 2026-07-29
**Status:** Approved, pending implementation

## Goal

The Assigned ("Owner") dropdown on a job's detail page must only offer people
who belong to the job's department: Web Dev jobs list web_dev members, Local
SEO jobs list local_seo members, and so on for every department board. Today
it lists every active user in the company.

## Current behavior (verified in prod 2026-07-29)

- The only jobs Assigned dropdown is the Owner `<select>` on
  `src/features/jobs/JobDetailPage.tsx` (kanban cards display the owner name
  read-only). All department boards share this page.
- The option list comes from `useMentionableUsers()` →
  `mentionable_users` RPC, which already returns each active user's
  `group_codes: string[]` (department group membership from
  `user_groups`/`groups`) and `is_admin`. No filtering is applied.
- `jobs.service_type` values match `groups.code` values (`web_dev`,
  `local_seo`, `web_seo`, `social_media`, `ads`, `maintenance`, `hosting`,
  `domains`, `ai_seo`), except `other` (no group).
- Group membership today: web_seo 1, local_seo 1, web_dev 1, social_media 1,
  ads 1, maintenance 3, franchise 1 — and **ai_seo 0, hosting 0, domains 0**.

## Owner decisions

1. **Admins always visible** — the filtered list is department members plus
   all admins, regardless of the admins' group membership.
2. **AI SEO mapping** — `ai_seo` jobs accept members of `ai_seo`, `local_seo`
   and `web_seo` (the SEO owners actually do the AI SEO work). All other
   service types map only to their own group code.
3. **Empty-department fallback** — if, after mapping, no department members
   exist (today: `hosting`, `domains`, `other`), fall back to the **full**
   staff list. Once those groups get members in Settings, the filter applies
   automatically.
4. **Current owner always visible** — if the job's current owner is not a
   department member (legacy assignment), they stay in the list so the
   assignment displays correctly and is not silently lost.

## Frontend changes (no DB/RPC changes)

1. **`src/features/jobs/utils/filterAssignableOwners.ts`** (new) — pure
   helper:
   `filterAssignableOwners(owners: MentionableUser[], serviceType: string, currentOwnerId: string | null): MentionableUser[]`
   - Accepted codes: `ai_seo` → `['ai_seo', 'local_seo', 'web_seo']`;
     otherwise `[serviceType]`.
   - Department members = owners whose `group_codes` intersect the accepted
     codes. If none, department members = all owners (fallback).
   - Result = department members ∪ admins (`is_admin`) ∪ current owner,
     deduplicated by `user_id`, preserving the input (name) ordering.
2. **`JobDetailPage.tsx`** — apply the helper to `owners` before rendering
   the `<option>` list. The read-only span and the current-owner name
   resolution keep using the unfiltered list.

## Out of scope (YAGNI)

- No backend enforcement: other write paths (and the fallback) can still
  assign cross-department; the DB accepts any user id. This is deliberate —
  it keeps legacy assignments safe.
- No change to `mentionable_users` (still used unfiltered for @mentions and
  kanban-card name display).
- No change to the sales-side `assignable_owners` flow (leads/deals).
- No UI for managing group membership (exists in Settings already).

## Testing (TDD)

- `filterAssignableOwners.test.ts` — web_dev keeps only web_dev members +
  admins; ai_seo accepts the three SEO codes; empty department falls back to
  full list; current owner outside the department is retained; dedup when the
  current owner is also an admin/member; ordering preserved.
- Live check after deploy: a Web Dev job lists only the web_dev member +
  admins; a Local SEO job lists only the local_seo member + admins; a hosting
  job still lists everyone (fallback).

## Changes / Revert

- Frontend-only; no migrations, no data changes.
- Revert = `git revert` of the implementation commit.
