# Jobs Kanban Sort Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user, persisted sort dropdown (Newest / Oldest / Newest updated / Oldest updated) to the Local SEO and Web SEO kanban boards, structured so the same control can be enabled on other boards later by adding one line.

**Architecture:** Both boards render one shared component (`JobsKanbanPage`). The current fixed sort lives in `kanbanGrouping.ts::compareJobsStable`. We (a) generalise the comparator into a `compareJobs(sortBy)` function that supports the 4 modes, (b) thread a `sortBy` parameter through `groupJobsForBoard`, (c) persist the choice per-user-per-board in a Zustand store (same pattern as `tasksSeenStore`), and (d) render a `FilterSelect` in the header, gated to a `SORT_ENABLED_BOARDS` set that today lists `local_seo` + `web_seo`. No backend/DB changes.

**Tech Stack:** React + TypeScript, TanStack Query, Zustand + persist middleware, shadcn-style `FilterSelect` (native `<select>` wrapper), Vitest.

---

## Design Decisions

- **Sort is client-side only.** `useJobs` already loads every non-archived job for the board (no pagination on service boards, unlike sales). Re-sorting is O(n log n) on a ~50–300-card set — fast enough to keep the fetch layer untouched and avoid an extra query key per sort mode.
- **Blocked column follows the same sort.** The Blocked bucket uses the same comparator, so switching to "Oldest updated" also reorders the Blocked column — consistent mental model.
- **`updated_at` ties break by `id` desc** (matches the existing `created_at` tie-breaker), so refetches never jitter.
- **Store is per-user, per-board.** Keys the persisted map by `${userId}:${board}` so different users on the same device (and different boards for the same user) keep independent choices.
- **Extending later = one line.** To enable on `social_media`/`ads`/`web_dev`/etc., add the board to `SORT_ENABLED_BOARDS` in `JobsKanbanPage.tsx`. No other code changes needed.
- **Greek + English labels** are inlined next to the existing `SERVICE_LABELS` / `SEARCH_PLACEHOLDER` maps — the page doesn't use i18next for these strings today.

## File Structure

- **Modify:** `src/features/jobs/kanbanGrouping.ts` — add `SortBy` type, `compareJobs(sortBy)`, extend `groupJobsForBoard` signature.
- **Modify:** `src/features/jobs/kanbanGrouping.test.ts` — new tests for the 4 sort modes on columns + blocked bucket.
- **Create:** `src/features/jobs/jobsBoardSortStore.ts` — Zustand + persist, keyed by `${userId}:${board}`.
- **Create:** `src/features/jobs/jobsBoardSortStore.test.ts` — reducer/persist tests.
- **Modify:** `src/features/jobs/JobsKanbanPage.tsx` — add `SORT_ENABLED_BOARDS`, wire store, render `FilterSelect`, pass `sortBy` to `groupJobsForBoard`.

## Changes / Revert

- Comparator generalisation (`compareJobsStable` → `compareJobs`) — revert by restoring the original single-mode comparator and dropping the `sortBy` argument from `groupJobsForBoard`.
- New store file + tests — delete file + test file.
- UI additions in `JobsKanbanPage.tsx` — remove the `FilterSelect` block, the `SORT_ENABLED_BOARDS` const, and the `useJobsBoardSort` import.
- No DB, no migration, no config — nothing to roll back on Supabase or Vercel.

---

### Task 1: Generalise the card comparator to support 4 sort modes

**Files:**
- Modify: `src/features/jobs/kanbanGrouping.ts` (currently ends at line 63)
- Test: `src/features/jobs/kanbanGrouping.test.ts`

- [ ] **Step 1: Write failing tests for `compareJobs`**

Append to `src/features/jobs/kanbanGrouping.test.ts` (at the end of the file, after the `hasBlockedColumn` describe block):

```typescript
import { compareJobs, type SortBy } from './kanbanGrouping';

describe('compareJobs', () => {
  const j = (id: string, created_at: string, updated_at: string): JobRow =>
    ({ id, created_at, updated_at, service_type: 'local_seo', stage_id: 'ls-opt', is_blocked: false } as JobRow);

  const rows = [
    j('a', '2026-06-10T00:00:00Z', '2026-06-25T00:00:00Z'),
    j('b', '2026-06-20T00:00:00Z', '2026-06-11T00:00:00Z'),
    j('c', '2026-06-15T00:00:00Z', '2026-06-18T00:00:00Z'),
  ];

  function sortedIds(sortBy: SortBy): string[] {
    return [...rows].sort(compareJobs(sortBy)).map((r) => r.id);
  }

  it('newest: created_at desc', () => {
    expect(sortedIds('newest')).toEqual(['b', 'c', 'a']);
  });

  it('oldest: created_at asc', () => {
    expect(sortedIds('oldest')).toEqual(['a', 'c', 'b']);
  });

  it('recent: updated_at desc', () => {
    expect(sortedIds('recent')).toEqual(['a', 'c', 'b']);
  });

  it('stale: updated_at asc', () => {
    expect(sortedIds('stale')).toEqual(['b', 'c', 'a']);
  });

  it('newest: breaks created_at ties by id desc so refetches do not jitter', () => {
    const ts = '2026-06-20T00:00:00Z';
    const tied = [
      j('a', ts, ts),
      j('c', ts, ts),
      j('b', ts, ts),
    ];
    expect([...tied].sort(compareJobs('newest')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('recent: breaks updated_at ties by id desc', () => {
    const ts = '2026-06-20T00:00:00Z';
    const tied = [
      j('a', '2026-01-01T00:00:00Z', ts),
      j('c', '2026-01-02T00:00:00Z', ts),
      j('b', '2026-01-03T00:00:00Z', ts),
    ];
    expect([...tied].sort(compareJobs('recent')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`
Expected: FAIL — `compareJobs` and `SortBy` are not exported.

- [ ] **Step 3: Implement `SortBy` + `compareJobs` in `kanbanGrouping.ts`**

**Add** the following ABOVE the existing `compareJobsStable` function (do NOT delete `compareJobsStable` yet — Task 2 removes it once `groupJobsForBoard` stops calling it). Insert around line 22, right after `hasBlockedColumn`:

```typescript
export type SortBy = 'newest' | 'oldest' | 'recent' | 'stale';

/**
 * Comparator for kanban cards. All modes tie-break by id desc so identical
 * timestamps produce a deterministic order (no jitter on refetch).
 *  - newest / oldest: by created_at
 *  - recent / stale:  by updated_at
 */
export function compareJobs(sortBy: SortBy): (a: JobRow, b: JobRow) => number {
  const key: 'created_at' | 'updated_at' =
    sortBy === 'recent' || sortBy === 'stale' ? 'updated_at' : 'created_at';
  const ascending = sortBy === 'oldest' || sortBy === 'stale';
  return (a, b) => {
    const va = (a[key] as string | null) ?? '';
    const vb = (b[key] as string | null) ?? '';
    if (va !== vb) {
      if (ascending) return va < vb ? -1 : 1;
      return va < vb ? 1 : -1;
    }
    // Always id desc for a stable tie-break, in every mode.
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;
    return 0;
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`
Expected: PASS — the new `compareJobs` block plus the existing `groupJobsForBoard`/`hasBlockedColumn` blocks. `groupJobsForBoard` still uses `compareJobsStable` internally, so the pre-existing card-order tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/kanbanGrouping.ts src/features/jobs/kanbanGrouping.test.ts
git commit -m "feat(jobs-board): add SortBy comparator (newest/oldest/recent/stale)"
```

---

### Task 2: Thread `sortBy` through `groupJobsForBoard`

**Files:**
- Modify: `src/features/jobs/kanbanGrouping.ts`
- Modify: `src/features/jobs/kanbanGrouping.test.ts`

- [ ] **Step 1: Write failing tests for `groupJobsForBoard` sort modes**

Append to `src/features/jobs/kanbanGrouping.test.ts`, inside a NEW `describe('groupJobsForBoard sortBy', ...)` block at the end of the file:

```typescript
describe('groupJobsForBoard sortBy', () => {
  const rows: JobRow[] = [
    job({ id: 'a', stage_id: 'ls-opt', created_at: '2026-06-10T00:00:00Z', updated_at: '2026-06-25T00:00:00Z' } as Partial<JobRow>),
    job({ id: 'b', stage_id: 'ls-opt', created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-11T00:00:00Z' } as Partial<JobRow>),
    job({ id: 'c', stage_id: 'ls-opt', created_at: '2026-06-15T00:00:00Z', updated_at: '2026-06-18T00:00:00Z' } as Partial<JobRow>),
  ];

  it('defaults to newest when no sortBy is supplied', () => {
    const { byColumn } = groupJobsForBoard({
      board: 'local_seo', jobs: rows, boardStages: localStages, stageById,
    });
    expect(byColumn.get('ls-opt')?.map((j) => j.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts a column by oldest', () => {
    const { byColumn } = groupJobsForBoard({
      board: 'local_seo', jobs: rows, boardStages: localStages, stageById, sortBy: 'oldest',
    });
    expect(byColumn.get('ls-opt')?.map((j) => j.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts a column by recent (updated_at desc)', () => {
    const { byColumn } = groupJobsForBoard({
      board: 'local_seo', jobs: rows, boardStages: localStages, stageById, sortBy: 'recent',
    });
    expect(byColumn.get('ls-opt')?.map((j) => j.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts the blocked bucket by the same sortBy', () => {
    const blockedRows: JobRow[] = [
      job({ id: 'a', stage_id: 'ls-opt', is_blocked: true, created_at: '2026-06-10T00:00:00Z', updated_at: '2026-06-25T00:00:00Z' } as Partial<JobRow>),
      job({ id: 'b', stage_id: 'ls-opt', is_blocked: true, created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-11T00:00:00Z' } as Partial<JobRow>),
    ];
    const { blocked } = groupJobsForBoard({
      board: 'local_seo', jobs: blockedRows, boardStages: localStages, stageById, sortBy: 'stale',
    });
    expect(blocked.map((j) => j.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`
Expected: FAIL — `groupJobsForBoard` does not accept `sortBy`.

- [ ] **Step 3: Extend `groupJobsForBoard` to accept `sortBy` and delete `compareJobsStable`**

In `src/features/jobs/kanbanGrouping.ts`:

1. Delete the `compareJobsStable` function block (the 12 lines starting at "Stable, fixed card order…").
2. Update the imports (top of file — no change needed).
3. Replace the `groupJobsForBoard` function with:

```typescript
export function groupJobsForBoard(args: {
  board: string;
  jobs: JobRow[];
  boardStages: StageLite[];
  stageById: Map<string, StageLite>;
  sortBy?: SortBy;
}): { byColumn: Map<string, JobRow[]>; blocked: JobRow[] } {
  const colByCode = new Map(args.boardStages.map((s) => [s.code, s]));
  const byColumn = new Map<string, JobRow[]>(args.boardStages.map((s) => [s.id, []]));
  const blocked: JobRow[] = [];
  const blockedColumn = hasBlockedColumn(args.board);

  for (const j of args.jobs) {
    if (!j.stage_id) continue;
    const jobStage = args.stageById.get(j.stage_id);
    if (!jobStage) continue;
    if (blockedColumn && j.is_blocked) {
      blocked.push(j);
      continue;
    }
    const code = jobStage.code;
    const col = colByCode.get(code);
    if (!col) continue;
    byColumn.get(col.id)?.push(j);
  }
  const cmp = compareJobs(args.sortBy ?? 'newest');
  for (const arr of byColumn.values()) arr.sort(cmp);
  blocked.sort(cmp);
  return { byColumn, blocked };
}
```

- [ ] **Step 4: Run the whole `kanbanGrouping` suite and confirm all tests pass**

Run: `npx vitest run src/features/jobs/kanbanGrouping.test.ts`
Expected: PASS — the pre-existing `groupJobsForBoard` describe block still passes because default sort is `'newest'`, which matches the previous fixed order.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/kanbanGrouping.ts src/features/jobs/kanbanGrouping.test.ts
git commit -m "feat(jobs-board): thread sortBy through groupJobsForBoard"
```

---

### Task 3: Persisted per-user-per-board sort store

**Files:**
- Create: `src/features/jobs/jobsBoardSortStore.ts`
- Test: `src/features/jobs/jobsBoardSortStore.test.ts`

- [ ] **Step 1: Write failing tests for the store**

Create `src/features/jobs/jobsBoardSortStore.test.ts`:

```typescript
import { beforeEach, describe, it, expect } from 'vitest';
import { useJobsBoardSortStore, getBoardSortKey } from './jobsBoardSortStore';

describe('jobsBoardSortStore', () => {
  beforeEach(() => {
    // Reset the zustand store between tests.
    useJobsBoardSortStore.setState({ byUserBoard: {} });
    window.localStorage.clear();
  });

  it('defaults to newest when nothing is stored', () => {
    const state = useJobsBoardSortStore.getState();
    expect(state.get('user-1', 'local_seo')).toBe('newest');
  });

  it('stores a value under a user+board composite key', () => {
    const state = useJobsBoardSortStore.getState();
    state.set('user-1', 'local_seo', 'recent');
    expect(useJobsBoardSortStore.getState().get('user-1', 'local_seo')).toBe('recent');
  });

  it('keeps independent values per user and per board', () => {
    const state = useJobsBoardSortStore.getState();
    state.set('user-1', 'local_seo', 'oldest');
    state.set('user-1', 'web_seo', 'stale');
    state.set('user-2', 'local_seo', 'recent');
    const s = useJobsBoardSortStore.getState();
    expect(s.get('user-1', 'local_seo')).toBe('oldest');
    expect(s.get('user-1', 'web_seo')).toBe('stale');
    expect(s.get('user-2', 'local_seo')).toBe('recent');
  });

  it('exposes a composite key helper', () => {
    expect(getBoardSortKey('user-1', 'local_seo')).toBe('user-1:local_seo');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/features/jobs/jobsBoardSortStore.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the store**

Create `src/features/jobs/jobsBoardSortStore.ts`:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortBy } from './kanbanGrouping';
import type { ServiceType } from './hooks/useJobs';

export function getBoardSortKey(userId: string, board: ServiceType): string {
  return `${userId}:${board}`;
}

type State = {
  byUserBoard: Record<string, SortBy>;
  get: (userId: string, board: ServiceType) => SortBy;
  set: (userId: string, board: ServiceType, sortBy: SortBy) => void;
};

export const useJobsBoardSortStore = create<State>()(
  persist(
    (set, get) => ({
      byUserBoard: {},
      get: (userId, board) => get().byUserBoard[getBoardSortKey(userId, board)] ?? 'newest',
      set: (userId, board, sortBy) =>
        set((s) => ({
          byUserBoard: { ...s.byUserBoard, [getBoardSortKey(userId, board)]: sortBy },
        })),
    }),
    { name: 'itdevcrm-jobs-board-sort-v1' },
  ),
);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/features/jobs/jobsBoardSortStore.test.ts`
Expected: PASS — all 4 assertions.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/jobsBoardSortStore.ts src/features/jobs/jobsBoardSortStore.test.ts
git commit -m "feat(jobs-board): persist per-user per-board sort choice"
```

---

### Task 4: Render the sort dropdown and wire it through the page

**Files:**
- Modify: `src/features/jobs/JobsKanbanPage.tsx`

- [ ] **Step 1: Add imports and the enable-set**

At the top of `src/features/jobs/JobsKanbanPage.tsx`, next to the existing imports:

```typescript
import { FilterSelect } from '@/components/layout/page-shell';
import { useJobsBoardSortStore } from './jobsBoardSortStore';
import type { SortBy } from './kanbanGrouping';
```

Below `SEARCH_PLACEHOLDER` (around line 41), add:

```typescript
// Sort dropdown is opt-in per board so we can roll out to Local + Web SEO first
// and extend to the other boards (social_media, ads, web_dev, hosting) with a
// single line change once they ask for it.
const SORT_ENABLED_BOARDS = new Set<ServiceType>(['local_seo', 'web_seo']);

const SORT_LABEL: { en: string; el: string } = {
  en: 'Sort',
  el: 'Ταξινόμηση',
};

const SORT_OPTIONS: { value: SortBy; en: string; el: string }[] = [
  { value: 'newest', en: 'Newest', el: 'Νεότερα' },
  { value: 'oldest', en: 'Oldest', el: 'Παλαιότερα' },
  { value: 'recent', en: 'Newest updated', el: 'Πιο πρόσφατη ενημέρωση' },
  { value: 'stale',  en: 'Oldest updated', el: 'Παλαιότερη ενημέρωση' },
];
```

- [ ] **Step 2: Read + write the sort state inside the component**

Inside `JobsKanbanPage`, immediately after the existing `const isAdmin = useAuthStore((s) => s.isAdmin);` line:

```typescript
  const sortBy = useJobsBoardSortStore((s) => s.byUserBoard[`${userId}:${serviceType}`] ?? 'newest');
  const setSortBy = useJobsBoardSortStore((s) => s.setSortBy);
```

- [ ] **Step 3: Pass `sortBy` to `groupJobsForBoard`**

Replace the existing `groupJobsForBoard` call (currently lines 86–91):

```typescript
  const { byColumn: jobsByStage, blocked: blockedJobs } = groupJobsForBoard({
    board: serviceType,
    jobs: filteredJobs,
    boardStages,
    stageById,
    sortBy,
  });
```

- [ ] **Step 4: Render the `FilterSelect` in the header**

Inside `<PageHeader>`, immediately AFTER the existing search `<Input>` block (right before the `{isAdmin ? (...) : (...)}` ternary at ~line 140), add:

```tsx
        {SORT_ENABLED_BOARDS.has(serviceType) && (
          <FilterSelect
            value={sortBy}
            aria-label={SORT_LABEL[lang]}
            title={SORT_LABEL[lang]}
            onChange={(e) => {
              if (!userId) return;
              setSortBy(userId, serviceType, e.target.value as SortBy);
            }}
            className="w-44"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o[lang]}</option>
            ))}
          </FilterSelect>
        )}
```

- [ ] **Step 5: Verify types + lint + build all pass**

Run: `npm run build`
Expected: green — tsc -b + eslint --max-warnings=0 both clean. If eslint complains about the `SortBy` import being type-only, change to `import type { SortBy } from './kanbanGrouping';` (already type-only in the snippet above — verify).

- [ ] **Step 6: Run the full Vitest suite once**

Run: `npx vitest run`
Expected: PASS — no regressions in unrelated suites (search, kanbanGrouping, jobsBoardSortStore).

- [ ] **Step 7: Commit**

```bash
git add src/features/jobs/JobsKanbanPage.tsx
git commit -m "feat(jobs-board): sort dropdown on Local/Web SEO kanbans"
```

---

### Task 5: Manual smoke test in the browser, then push

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Vite dev server on `http://localhost:5173`.

- [ ] **Step 2: Verify Local SEO board**

Log in (e.g. `info@itdev.gr` / `123456789` per the smoke-test memory), navigate to `/tech/local-seo`.
Verify:
- The Sort dropdown is visible in the header, next to the search box.
- Default value shows "Newest" (Greek: "Νεότερα").
- Switching to "Oldest updated" (Παλαιότερη ενημέρωση) visibly re-orders cards inside at least one non-empty column and the Blocked column.
- Reload the page — the selection persists.

- [ ] **Step 3: Verify Web SEO board**

Navigate to `/tech/web-seo`. Repeat the same three checks. Verify that its selection is independent from Local SEO (change one to "Oldest", switch tabs, confirm the other is still on its own choice).

- [ ] **Step 4: Verify other boards are unaffected**

Navigate to `/tech/web-dev` (or any other tech board). Confirm no Sort dropdown appears and the board looks identical to before.

- [ ] **Step 5: Push to main**

Per project convention (`no PRs`), push directly:

```bash
git push origin main
```

Expected: Vercel picks up the deploy. Wait for the deploy to go green in Vercel.

- [ ] **Step 6: Prod smoke on `www.itdevcrm.com/tech/local-seo`**

Repeat Step 2 checks on production. If anything is off, revert the last two commits with a fresh commit (do NOT force-push).

---

## Notes for the Executor

- **No DB / migration / edge-function changes** — this plan touches only the React app.
- **No `types:gen` step** — no new tables/columns.
- **No parallel work** on `src/features/jobs/JobsKanbanPage.tsx` or `kanbanGrouping.ts` while these tasks run, to avoid the collision pattern documented in earlier memories (parallel agents modifying the same file → git rebase pain).
- **Extending to another board later** = add its `ServiceType` value to `SORT_ENABLED_BOARDS`. Nothing else.
