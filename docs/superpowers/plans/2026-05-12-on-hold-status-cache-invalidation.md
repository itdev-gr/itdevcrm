# On-Hold → Blocked: cache invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the accounting kanban move mutation succeeds, also invalidate the deal-detail and clients queries so the deal detail page sees `client.status = 'blocked'` without a manual reload.

**Architecture:** Single-file change to `useMoveAccountingStage`. Extend the existing `onSettled` callback to invalidate two more query keys (`queryKeys.deal(dealId)` and `queryKeys.clients()`). One new unit test on the hook. No DB or schema work.

**Tech Stack:** React, TanStack Query, Vitest, `@testing-library/react`, `vi.hoisted` mocks for `@/lib/supabase`.

**Spec:** `docs/superpowers/specs/2026-05-12-on-hold-status-cache-invalidation-design.md`

---

## File Map

- **Modify:** `src/features/accounting/hooks/useMoveAccountingStage.ts` — extend `onSettled` to invalidate two more keys.
- **Create:** `src/features/accounting/hooks/useMoveAccountingStage.test.ts` — single test covering the invalidation contract.

The mocking pattern matches existing hook tests in `src/features/assigned_tasks/hooks/`. No other files change.

---

## Task 1: Failing test for `useMoveAccountingStage` invalidations

**Files:**
- Create: `src/features/accounting/hooks/useMoveAccountingStage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, from } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_scope: string, _op: string, fn: (...args: unknown[]) => unknown) => fn,
}));

import { useMoveAccountingStage } from './useMoveAccountingStage';
import { queryKeys } from '@/lib/queryKeys';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useMoveAccountingStage', () => {
  beforeEach(() => {
    from.mockClear();
    update.mockClear();
    eq.mockClear();
  });

  it('invalidates accountingDeals, the deal detail query and clients on settle', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useMoveAccountingStage(), { wrapper: wrap(qc) });

    await result.current.mutateAsync({ dealId: 'deal-1', stageId: 'stage-on-hold' });

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
      expect(keys).toContainEqual(queryKeys.accountingDeals());
      expect(keys).toContainEqual(queryKeys.deal('deal-1'));
      expect(keys).toContainEqual(queryKeys.clients());
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/accounting/hooks/useMoveAccountingStage.test.ts`
Expected: **FAIL** — the spy sees only `queryKeys.accountingDeals()`; `queryKeys.deal('deal-1')` and `queryKeys.clients()` are missing from the invalidations list.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/features/accounting/hooks/useMoveAccountingStage.test.ts
git commit -m "test(accounting): assert move-stage invalidates deal + clients caches"
```

---

## Task 2: Extend `onSettled` so the test passes

**Files:**
- Modify: `src/features/accounting/hooks/useMoveAccountingStage.ts:34-36`

- [ ] **Step 1: Update the hook**

Replace the existing `onSettled` block:

```ts
onSettled: () => {
  void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
},
```

with:

```ts
onSettled: (_data, _err, vars) => {
  void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
  void qc.invalidateQueries({ queryKey: queryKeys.deal(vars.dealId) });
  void qc.invalidateQueries({ queryKey: queryKeys.clients() });
},
```

Why `vars.dealId` (the third callback argument): TanStack Query passes the mutation variables to `onSettled` as the third positional argument. We need `dealId` to derive the per-deal key.

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/features/accounting/hooks/useMoveAccountingStage.test.ts`
Expected: **PASS** (1 test, 1 assertion block).

- [ ] **Step 3: Run the full accounting + adjacent suite**

Run: `npx vitest run src/features/accounting src/features/deals`
Expected: all green. The change is additive — existing behaviour is unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Lint the touched files**

Run: `npx eslint src/features/accounting/hooks/useMoveAccountingStage.ts src/features/accounting/hooks/useMoveAccountingStage.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/accounting/hooks/useMoveAccountingStage.ts
git commit -m "fix(accounting): invalidate deal + clients caches after stage move"
```

---

## Task 3: Push to main + manual smoke

- [ ] **Step 1: Push**

```bash
git push origin main
```

Expected: push succeeds (the spec commit `5089d2b` + Task 1 + Task 2 commits go live).

- [ ] **Step 2: Manual verification (live)**

1. Open `/deals/<id>` for any deal currently NOT in On Hold (e.g., a `Pending` deal). Note the **Status** combobox value at the page header.
2. In a second tab, open `/accounting/onboarding`. Drag the same deal card to the **On Hold** column.
3. Switch back to the first tab. Within ~1s of focus, the Status combobox should refetch and show **Blocked**. No hard reload required.
4. Drag the deal back to its original column on the kanban. Switch back to the deal tab — Status should return to its previous value (e.g. `active` if accounting moved to `partial_payment` / `paid_in_full`, or `new` for a non-mapped stage).

If step 3 still shows the stale value, the cache is not being invalidated — re-check that `onSettled` runs (it should: TanStack Query always calls it after `mutationFn` resolves or throws). Check the network tab for a follow-up GET to `/rest/v1/deals?id=eq.<id>` triggered by the invalidation.

---

## Self-Review Notes

- **Spec coverage:**
  - Spec § "Goal" — invalidate deal-detail + clients on the kanban move → Task 2 step 1.
  - Spec § "Design" — single-file change, `onSettled`, derives keys from `dealId` in variables → Task 2 step 1 + commentary.
  - Spec § "Testing" — unit test on the hook asserting both keys are invalidated → Task 1.
  - Spec § "Non-goals" (no DB, no realtime, no other paths) — honoured: only `useMoveAccountingStage.ts` and its test are touched.
  - Spec § "Manual smoke" — mirrored in Task 3 step 2.

- **Type / name consistency:**
  - `queryKeys.deal(id: string)` — verified at `src/lib/queryKeys.ts:18`.
  - `queryKeys.clients()` — verified at `src/lib/queryKeys.ts:13`.
  - `queryKeys.accountingDeals()` — verified at `src/lib/queryKeys.ts:32`.
  - Mutation variables type `{ dealId: string; stageId: string }` is preserved; `onSettled` receives them as the third arg per TanStack Query v5 typings.
  - `captureMutation` mock signature matches the wrapping in the hook (scope, op, fn).

- **No placeholders, every step has runnable commands or full code blocks.**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-12-on-hold-status-cache-invalidation.md`.
