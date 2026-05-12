# On-Hold → Blocked: cache invalidation on the deal-detail page

**Date:** 2026-05-12
**Status:** Approved (to be implemented)
**Scope:** Frontend only. No schema, no migration.

## Problem

When a deal is moved to the **On Hold** column on the accounting onboarding
kanban, the server-side trigger
`deals_sync_client_status_on_stage_change` (migration `20260503000020`) correctly
sets `clients.status = 'blocked'`. The kanban view refreshes via its mutation +
realtime channel.

However, the deal-detail page (`/deals/<id>`) reads `deal.client.status` via the
`useDeal` query. That cache is **not** invalidated when the move happens, so a
user who has the deal detail page open in another tab — or navigates back to it
from the kanban — sees the previous status (e.g. `active`) until they
hard-reload.

Symptom reported by the user:
> "When a deal is moved to On Hold his status must be blocked."

The DB state is already correct (verified: all 4 deals currently in the On Hold
column have `clients.status = 'blocked'`). The bug is purely a client-side
cache invalidation gap.

## Goal

After `useMoveAccountingStage` succeeds, invalidate the queries that hold the
client status for the moved deal so the deal-detail page reflects the new
status without a manual reload.

## Non-goals

- Adding a new realtime channel on `clients`. (Considered. Heavier than the bug
  warrants and not requested.)
- Changing the DB trigger or schema.
- Locking the `Status` combobox on the deal-detail page so it can't be changed
  back to `active` while accounting stage is `on_hold`. (Possible future work,
  not in scope.)
- Anything outside the accounting kanban move path. Other stage-move paths
  (e.g., tech kanbans moving jobs) keep their current invalidation behaviour.

## Design

Single file change: `src/features/accounting/hooks/useMoveAccountingStage.ts`.

In the existing `onSettled`, also invalidate:

1. `queryKeys.deal(dealId)` — the deal-detail query (`useDeal`), which embeds
   `client.status`.
2. `queryKeys.clients()` — the clients list, in case any list view reads
   status.

The mutation already has `dealId` in its variables, so the keys can be derived
without extra fetches.

### Why `onSettled` and not `onSuccess`

The current hook uses `onSettled` for the existing invalidation. We keep the
same lifecycle for consistency — even on retry, the optimistic state is rolled
back and the next refetch picks up the server truth.

### What stays the same

- The optimistic update logic in `onMutate` and the rollback in `onError`.
- The existing `queryKeys.accountingDeals()` invalidation.
- The DB trigger.

### What about other stage-move paths?

The tech-board move hooks (web-seo, local-seo, social-media, hosting, ads,
ai-seo) operate on **jobs**, not deals. The user's report and confirmed scope
are accounting-only, so those hooks are untouched.

## Testing

One new test in `useMoveAccountingStage.test.ts` (file exists already if there
are sibling tests — otherwise create it alongside the hook):

- **It invalidates the deal-detail and clients queries on settle.** Spy on
  `queryClient.invalidateQueries` and assert it was called with both
  `queryKeys.deal(dealId)` and `queryKeys.clients()` in addition to
  `queryKeys.accountingDeals()`.

Manual smoke (after merge):

1. Open `/deals/<id>` for any deal not in On Hold; note its Status combobox value.
2. In another tab, open `/accounting/onboarding`; drag the same deal to **On Hold**.
3. Switch back to the deal-detail tab. The Status combobox should now read
   **Blocked** without a manual refresh (React Query refetches on tab focus by
   default).

## Risks

- **`queryKeys.clients()` is broad.** Invalidating it forces all clients-list
  consumers to refetch. Acceptable: clients lists are small and infrequent;
  the kanban move is also infrequent (drag-drop, not background traffic).
- **No realtime fallback for *other* writers.** If something other than the
  kanban mutation updates `clients.status` (e.g., manual edit), the deal-detail
  page still won't auto-refresh. Out of scope for this fix.

## Migration / rollout

None. Frontend-only patch, deploys with the next push to `main` → Vercel.
