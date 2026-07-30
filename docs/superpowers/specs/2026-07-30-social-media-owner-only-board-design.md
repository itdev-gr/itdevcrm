# Social Media kanban: owner-only view for non-admins

**Date:** 2026-07-30 · **Status:** SHIPPED (commits 3105630, 126b3c1)

## Requirement

Owner request: each social media user must see on their kanban ONLY the jobs
assigned to them. Previously the board defaulted to "Only mine" for non-admins
but the "All my group's" toggle (`?mine=0`) revealed the whole department.

## Decisions

1. **Scope: social_media board only.** Other boards keep the toggle. Extending
   is one entry in `OWNER_ONLY_BOARDS` (`src/features/jobs/boardScope.ts`).
2. **Unassigned jobs are invisible to reps** — admins assign owners. Until the
   backlog of unassigned social jobs is distributed, reps see an empty board.
3. **Frontend-only** (same precedent as `assignableOwners.ts`): job detail
   pages, «Οι Πελάτες μου», search and RLS are unchanged. A direct job link
   still opens. Hard data isolation would be a separate RLS project.
4. **Admins unchanged** — always `Admin view · N`.

## Implementation

- `src/features/jobs/boardScope.ts` — `isOwnerOnlyBoard(serviceType)` over a
  `ReadonlySet` (`['social_media']`). Unit-tested in `boardScope.test.ts`.
- `src/features/jobs/JobsKanbanPage.tsx` — `ownerOnly = !isAdmin &&
  isOwnerOnlyBoard(serviceType)`; `onlyMine` forces true when `ownerOnly`
  (ignores `?mine=0` deep links); the toggle button is replaced by a static,
  non-clickable "Only mine · N" chip.

## Verification (done 2026-07-30, local dev against prod DB)

- `boardScope.test.ts` green; `npm run build` clean.
- stelios@ (social_media rep): `/tech/social-media?mine=0` → 0 cards, static
  chip, no toggle.
- info@ (admin): `Admin view · 22` with all cards — unchanged.
- Pre-existing unrelated test failures in JobEmailStatusBadge/JobInfoPanel/
  JobNotesCard (10) confirmed failing on clean HEAD too.

## Rollback

Frontend-only — `git revert 126b3c1 3105630`. No DB/RLS changes.

## Follow-ups

- Admin must distribute owners on the unassigned social jobs or reps see an
  empty board.
- Onboarding PDF updated to v1.1 (storage `attachments/compose/guides/…`) —
  board section now describes the personal view instead of the toggle.
