# Sales Pipeline Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the sales kanban from mounting one draggable card per lead so the board (and the leads list) stays fast and never crashes, regardless of how many leads exist.

**Architecture:** The board becomes *scoped & capped*. A new DB function returns the true lead count per sales stage; a new hook fetches only the top ~50 leads per **active** stage (server-side ordered + searched) plus those counts. Dead stages (`not_interested`, `dead_end` — 2,362 leads / 59%) render **collapsed**: still a drop target, but zero cards mounted. Each column shows its true total and an "open in list" overflow link. The full volume lives in `/sales/leads`, whose render is paginated client-side. Owner-name lookup is lifted out of the per-card render.

**Tech Stack:** React, @tanstack/react-query, @dnd-kit/core, Supabase (PostgREST + a `security invoker` SQL function), Vitest + Testing Library.

---

## Root Cause (confirmed by scan)

- `SalesKanbanCard.tsx` calls `useDraggable` **per card**, plus `useAssignableOwners()` + 2× `useTranslation()` and an O(n) `owners.find()`.
- `useLeads` was changed to page through **all** leads (3,981). `SalesKanbanPage` (for admins, no owner filter) renders them all inside one `DndContext` → ~4,000 draggable DOM nodes → main-thread freeze / tab crash.
- `LeadsListPage` uses the same `useLeads({})` → renders ~4,000 `LeadRowEditor` rows → same class of problem ("everywhere").
- `useComments` is correctly scoped per-parent — **not** a hotspot. The 42,696 comments are never loaded in bulk.

## Per-stage lead counts (current prod)

| code | en | leads | board role |
|---|---|--:|---|
| unique_lead | Unique Lead | (intake) | active |
| new_lead | New Lead | 533 | active |
| no_answer | No Answer | 483 | active |
| constant_na | Constant NA | 274 | active |
| working_on_it | Working On It | 126 | active |
| offer_sent | Offer Sent | 54 | active |
| scheduled | Scheduled | 111 | active |
| hot | Hot | 36 | active |
| won | Won | 2 | active |
| **not_interested** | **Not Interested** | **1,744** | **collapsed** |
| **dead_end** | **Dead End** | **618** | **collapsed** |

After this plan the board mounts at most `active_stages × 50` cards (≈450, realistically far fewer), independent of total lead volume.

## File Structure

- **Create** `supabase/migrations/20260618000004_sales_kanban_counts.sql` — counts RPC + generated total-value column + indexes.
- **Create** `src/features/sales/salesKanbanColumns.ts` — pure, testable helpers (sort mapping, collapsed-stage test, column assembly, overflow).
- **Create** `src/features/sales/salesKanbanColumns.test.ts` — unit tests for the helpers.
- **Create** `src/features/sales/hooks/useSalesKanbanColumns.ts` — react-query hook (counts RPC + per-active-stage capped fetch).
- **Modify** `src/lib/queryKeys.ts` — add `salesKanban` key under the `['leads', …]` prefix (so existing realtime/move invalidations still catch it).
- **Modify** `src/features/sales/SalesKanbanCard.tsx` — accept `ownerName`/`wonByName` props; drop `useAssignableOwners`.
- **Modify** `src/features/sales/SalesKanbanColumn.tsx` + `SalesKanbanColumn.test.tsx` — `total`, `collapsed`, `overflowHref`, `ownerNameFor` props; collapsed renders zero cards; overflow footer.
- **Modify** `src/features/sales/SalesKanbanPage.tsx` — use `useSalesKanbanColumns`; build owner-name map once; render active + collapsed columns.
- **Modify** `src/features/leads/LeadsListPage.tsx` — client-side render pagination + read `?stage`/`?owner` URL params.

---

### Task 1: DB — per-stage counts RPC, total-value column, indexes

**Files:**
- Create: `supabase/migrations/20260618000004_sales_kanban_counts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Sales kanban performance: a count-per-sales-stage RPC (so the board can show
-- true totals without loading every lead), a generated total-value column +
-- ordering indexes (so "top N per stage" is server-side and cheap), used by
-- src/features/sales/hooks/useSalesKanbanColumns.ts.

-- Generated total value so the board can ORDER BY it (value_high / value_low).
alter table public.leads
  add column if not exists estimated_total_value numeric
  generated always as (
    coalesce(estimated_one_time_value, 0) + coalesce(estimated_monthly_value, 0)
  ) stored;

-- Indexes backing the capped per-stage ordered fetch.
create index if not exists leads_stage_created_idx on public.leads (stage_id, created_at desc) where not archived;
create index if not exists leads_stage_updated_idx on public.leads (stage_id, updated_at desc) where not archived;
create index if not exists leads_stage_value_idx   on public.leads (stage_id, estimated_total_value desc) where not archived;

-- SECURITY INVOKER => RLS on leads applies => a sales rep only counts their own
-- leads automatically; admins count all. p_search mirrors the board search box.
create or replace function public.sales_kanban_counts(
  p_owner uuid default null,
  p_source text default null,
  p_search text default null
) returns table (stage_id uuid, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select l.stage_id, count(*)::bigint as total
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where not l.archived
    and ps.board = 'sales'
    and (p_owner is null or l.owner_user_id = p_owner)
    and (p_source is null or l.source = p_source)
    and (
      p_search is null or p_search = ''
      or l.title ilike '%' || p_search || '%'
      or l.company_name ilike '%' || p_search || '%'
      or l.contact_first_name ilike '%' || p_search || '%'
      or l.contact_last_name ilike '%' || p_search || '%'
      or l.email ilike '%' || p_search || '%'
      or l.phone ilike '%' || p_search || '%'
    )
  group by l.stage_id;
$$;

grant execute on function public.sales_kanban_counts(uuid, text, text) to authenticated;

-- ROLLBACK:
-- drop function if exists public.sales_kanban_counts(uuid, text, text);
-- drop index if exists public.leads_stage_value_idx;
-- drop index if exists public.leads_stage_updated_idx;
-- drop index if exists public.leads_stage_created_idx;
-- alter table public.leads drop column if exists estimated_total_value;
```

- [ ] **Step 2: Apply to prod via the Management API SQL endpoint**

Apply the file's SQL with the `sbp_` token (POST to `https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`). Then record it in `schema_migrations` so a future `supabase db push` skips it:
`insert into supabase_migrations.schema_migrations (version, name, statements) values ('20260618000004','sales_kanban_counts','{}') on conflict do nothing;`

- [ ] **Step 3: Verify counts match reality**

Run (as the service token, RLS bypassed → totals = all):
`select * from public.sales_kanban_counts(null, null, null) order by total desc;`
Expected (matches the table above): not_interested 1744, dead_end 618, new_lead 533, no_answer 483, constant_na 274, working_on_it 126, scheduled 111, offer_sent 54, hot 36, won 2.

- [ ] **Step 4: Regenerate Supabase types (so `estimated_total_value` exists on `LeadRow`)**

Run: `SUPABASE_ACCESS_TOKEN=<sbp> supabase gen types typescript --project-id xujlrclyzxrvxszepquy > src/types/supabase.ts`
Expected: `src/types/supabase.ts` now lists `estimated_total_value` on `leads` Row and `sales_kanban_counts` under `Functions`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618000004_sales_kanban_counts.sql src/types/supabase.ts
git commit -m "feat(sales): per-stage lead counts RPC + total-value column for capped kanban"
```

---

### Task 2: Pure helpers for the capped board

**Files:**
- Create: `src/features/sales/salesKanbanColumns.ts`
- Test: `src/features/sales/salesKanbanColumns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  KANBAN_COLUMN_LIMIT,
  COLLAPSED_STAGE_CODES,
  isCollapsedStage,
  orderForSort,
  overflowCount,
} from './salesKanbanColumns';

describe('salesKanbanColumns', () => {
  it('marks dead stages as collapsed', () => {
    expect(isCollapsedStage('not_interested')).toBe(true);
    expect(isCollapsedStage('dead_end')).toBe(true);
    expect(isCollapsedStage('new_lead')).toBe(false);
    expect(isCollapsedStage('won')).toBe(false);
  });

  it('maps every sort option to a server order clause', () => {
    expect(orderForSort('newest')).toEqual({ column: 'created_at', ascending: false });
    expect(orderForSort('oldest')).toEqual({ column: 'created_at', ascending: true });
    expect(orderForSort('recent')).toEqual({ column: 'updated_at', ascending: false });
    expect(orderForSort('value_high')).toEqual({ column: 'estimated_total_value', ascending: false });
    expect(orderForSort('value_low')).toEqual({ column: 'estimated_total_value', ascending: true });
  });

  it('computes overflow = total minus shown (never negative)', () => {
    expect(overflowCount(533, 50)).toBe(483);
    expect(overflowCount(10, 50)).toBe(0);
    expect(overflowCount(50, 50)).toBe(0);
  });

  it('exposes a sane cap and the collapsed set', () => {
    expect(KANBAN_COLUMN_LIMIT).toBe(50);
    expect(COLLAPSED_STAGE_CODES).toEqual(['not_interested', 'dead_end']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sales/salesKanbanColumns.test.ts`
Expected: FAIL — "Cannot find module './salesKanbanColumns'".

- [ ] **Step 3: Write minimal implementation**

```ts
export const KANBAN_COLUMN_LIMIT = 50;

export const COLLAPSED_STAGE_CODES = ['not_interested', 'dead_end'] as const;

export type SortBy = 'newest' | 'oldest' | 'value_high' | 'value_low' | 'recent';

export function isCollapsedStage(code: string): boolean {
  return (COLLAPSED_STAGE_CODES as readonly string[]).includes(code);
}

export function orderForSort(sortBy: SortBy): { column: string; ascending: boolean } {
  switch (sortBy) {
    case 'oldest':
      return { column: 'created_at', ascending: true };
    case 'recent':
      return { column: 'updated_at', ascending: false };
    case 'value_high':
      return { column: 'estimated_total_value', ascending: false };
    case 'value_low':
      return { column: 'estimated_total_value', ascending: true };
    case 'newest':
    default:
      return { column: 'created_at', ascending: false };
  }
}

export function overflowCount(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sales/salesKanbanColumns.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/salesKanbanColumns.ts src/features/sales/salesKanbanColumns.test.ts
git commit -m "feat(sales): pure helpers for capped kanban columns"
```

---

### Task 3: `useSalesKanbanColumns` hook (counts + capped per-stage fetch)

**Files:**
- Create: `src/features/sales/hooks/useSalesKanbanColumns.ts`
- Modify: `src/lib/queryKeys.ts:35` (add a `salesKanban` key, under the `['leads', …]` prefix)

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, directly after the existing `leads:` entry (line ~35), add:

```ts
  salesKanban: (filters: Record<string, string | undefined>) =>
    ['leads', 'kanban', filters] as const,
```

(Prefix `['leads', …]` means `useSalesKanbanRealtime` and `useMoveLeadStage`/`useConvertLead`, which invalidate `queryKeys.leads()` = `['leads']`, automatically refetch the board.)

- [ ] **Step 2: Write the hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import {
  KANBAN_COLUMN_LIMIT,
  isCollapsedStage,
  orderForSort,
  type SortBy,
} from '../salesKanbanColumns';

export type KanbanStage = { id: string; code: string };

export type KanbanColumn = {
  stageId: string;
  leads: LeadRow[]; // ≤ KANBAN_COLUMN_LIMIT; empty for collapsed stages
  total: number;
};

export type KanbanColumnsFilter = {
  ownerId?: string;
  source?: 'meta' | 'manual' | 'import';
  search?: string;
  sortBy: SortBy;
};

const LEAD_SELECT = '*, stage:pipeline_stages(id, code, board, display_names)';

// Pure: builds the PostgREST `or=` clause for a search term, or null if empty.
// (Kept free of builder types so it can't snag tsc; applied inline below.)
function searchOrClause(search: string): string | null {
  const v = search.replace(/[%,()]/g, ' ').trim();
  if (!v) return null;
  const like = `%${v}%`;
  return [
    `title.ilike.${like}`,
    `company_name.ilike.${like}`,
    `contact_first_name.ilike.${like}`,
    `contact_last_name.ilike.${like}`,
    `email.ilike.${like}`,
    `phone.ilike.${like}`,
  ].join(',');
}

export function useSalesKanbanColumns(stages: KanbanStage[], filter: KanbanColumnsFilter) {
  const keyFilter = {
    owner: filter.ownerId,
    source: filter.source,
    search: filter.search?.trim() || undefined,
    sort: filter.sortBy,
    stages: stages.map((s) => s.id).join(','),
  };

  return useQuery({
    queryKey: queryKeys.salesKanban(keyFilter),
    enabled: stages.length > 0,
    queryFn: async (): Promise<KanbanColumn[]> => {
      const search = filter.search?.trim() ?? '';

      // 1. True totals per stage (RLS-scoped). One round trip.
      const { data: countRows, error: countErr } = await supabase.rpc('sales_kanban_counts', {
        p_owner: filter.ownerId ?? null,
        p_source: filter.source ?? null,
        p_search: search || null,
      });
      if (countErr) throw new Error(countErr.message);
      const totals = new Map<string, number>();
      for (const r of (countRows ?? []) as { stage_id: string; total: number }[]) {
        totals.set(r.stage_id, Number(r.total));
      }

      // 2. Capped, ordered cards for ACTIVE stages only (parallel).
      const order = orderForSort(filter.sortBy);
      const orClause = searchOrClause(search);
      const active = stages.filter((s) => !isCollapsedStage(s.code));
      const fetched = await Promise.all(
        active.map(async (s) => {
          let q = supabase
            .from('leads')
            .select(LEAD_SELECT)
            .eq('archived', false)
            .eq('stage_id', s.id)
            .order(order.column, { ascending: order.ascending })
            .limit(KANBAN_COLUMN_LIMIT);
          if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
          if (filter.source) q = q.eq('source', filter.source);
          if (orClause) q = q.or(orClause);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          return [s.id, (data ?? []) as unknown as LeadRow[]] as const;
        }),
      );
      const leadsByStage = new Map<string, LeadRow[]>(fetched);

      return stages.map((s) => ({
        stageId: s.id,
        leads: leadsByStage.get(s.id) ?? [],
        total: totals.get(s.id) ?? 0,
      }));
    },
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (relies on Task 1 Step 4 having regenerated `supabase.ts` so `sales_kanban_counts` is a known RPC).

- [ ] **Step 4: Commit**

```bash
git add src/features/sales/hooks/useSalesKanbanColumns.ts src/lib/queryKeys.ts
git commit -m "feat(sales): useSalesKanbanColumns — capped per-stage fetch + counts"
```

---

### Task 4: Lift owner lookup out of the card

**Files:**
- Modify: `src/features/sales/SalesKanbanCard.tsx:8,18-23,75,87-90`

- [ ] **Step 1: Change the component signature to take names as props**

Replace the `useAssignableOwners` import + the owner/wonBy derivation. New top of component:

```tsx
// remove: import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';

export function SalesKanbanCard({
  lead,
  ownerName,
  wonByName,
}: {
  lead: LeadRow;
  ownerName?: string;
  wonByName?: string;
}) {
  const { t, i18n } = useTranslation('leads');
  const { t: tDeals } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isWon = lead.stage?.code === 'won';
  // ...useDraggable unchanged...
```

- [ ] **Step 2: Use the props in the JSX**

Owner line (was line ~75):
```tsx
          <div className="text-[10px] text-slate-500">
            👤 {ownerName || t('owner.unassigned')}
          </div>
```
Won-by line (was lines ~87-90):
```tsx
          {isWon && wonByName && (
            <div className="text-[10px] text-emerald-700">
              {t('sales_person.label')}: {wonByName}
            </div>
          )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY at the two call sites (`SalesKanbanPage` DragOverlay + the column) that don't yet pass the new props — fixed in Tasks 5–6. (If running this task in isolation, those are expected and resolved next.)

- [ ] **Step 4: Commit**

```bash
git add src/features/sales/SalesKanbanCard.tsx
git commit -m "perf(sales): pass owner/wonBy names into card instead of per-card query"
```

---

### Task 5: Column — collapsed mode + overflow footer

**Files:**
- Modify: `src/features/sales/SalesKanbanColumn.tsx`
- Test: `src/features/sales/SalesKanbanColumn.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `SalesKanbanColumn.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SalesKanbanColumn } from './SalesKanbanColumn';

function renderCol(props: Partial<React.ComponentProps<typeof SalesKanbanColumn>> = {}) {
  return render(
    <MemoryRouter>
      <DndContext>
        <SalesKanbanColumn
          stageId="s1"
          stageLabel="New Lead"
          leads={[]}
          total={0}
          overflowHref="/sales/leads?stage=s1"
          nameFor={() => ''}
          {...props}
        />
      </DndContext>
    </MemoryRouter>,
  );
}

describe('SalesKanbanColumn', () => {
  it('shows a lock when locked', () => {
    renderCol({ locked: true });
    expect(screen.getByTitle('locked')).toBeInTheDocument();
  });

  it('renders zero cards when collapsed, with a link to the list', () => {
    const leads = [{ id: 'a' }, { id: 'b' }] as never[];
    renderCol({ collapsed: true, leads, total: 1744 });
    expect(screen.queryByRole('link', { name: /1744|1,744/ })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="kanban-card"]').length).toBe(0);
  });

  it('shows an overflow link when total exceeds shown', () => {
    const leads = Array.from({ length: 50 }, (_, i) => ({ id: String(i) })) as never[];
    renderCol({ leads, total: 533 });
    expect(screen.getByRole('link', { name: /483/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sales/SalesKanbanColumn.test.tsx`
Expected: FAIL — new props don't exist; no overflow/collapsed link rendered.

- [ ] **Step 3: Implement the column**

Replace `SalesKanbanColumn.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import { overflowCount } from './salesKanbanColumns';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

type Props = {
  stageId: string;
  stageLabel: string;
  leads: LeadRow[];
  total: number;
  overflowHref: string;
  nameFor: (userId: string | null) => string;
  locked?: boolean;
  collapsed?: boolean;
};

export function SalesKanbanColumn({
  stageId,
  stageLabel,
  leads,
  total,
  overflowHref,
  nameFor,
  locked = false,
  collapsed = false,
}: Props) {
  const { t } = useTranslation('sales');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const overflow = overflowCount(total, leads.length);

  return (
    <div
      ref={setNodeRef}
      className={`flex ${collapsed ? 'w-44' : 'w-72'} shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        {locked && (
          <span title="locked" aria-label="locked" className="mr-1">
            🔒
          </span>
        )}
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({total})</span>
      </header>

      {collapsed ? (
        <div className="p-3 text-center">
          <Link to={overflowHref} className="text-xs text-blue-700 hover:underline">
            {t('kanban.open_in_list', { count: total })}
          </Link>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          {leads.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t('kanban.empty_column')}
            </p>
          ) : (
            <>
              {leads.map((l) => (
                <div key={l.id} data-testid="kanban-card">
                  <SalesKanbanCard
                    lead={l}
                    ownerName={nameFor(l.owner_user_id)}
                    wonByName={nameFor(l.won_by_user_id)}
                  />
                </div>
              ))}
              {overflow > 0 && (
                <Link
                  to={overflowHref}
                  className="block rounded-md border border-dashed py-2 text-center text-xs text-blue-700 hover:bg-slate-100"
                >
                  {t('kanban.more_in_list', { count: overflow })}
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the two i18n keys**

In `src/i18n/locales/en/sales.json` under `kanban`, add:
```json
"open_in_list": "Open {{count}} in list →",
"more_in_list": "+{{count}} more — open in list →"
```
In `src/i18n/locales/el/sales.json` under `kanban`, add:
```json
"open_in_list": "Άνοιγμα {{count}} στη λίστα →",
"more_in_list": "+{{count}} ακόμη — άνοιγμα στη λίστα →"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/sales/SalesKanbanColumn.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/sales/SalesKanbanColumn.tsx src/features/sales/SalesKanbanColumn.test.tsx src/i18n/locales/en/sales.json src/i18n/locales/el/sales.json
git commit -m "feat(sales): collapsed dead-stage columns + overflow 'open in list' link"
```

---

### Task 6: Page — use the capped hook, build owner map once

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx`

- [ ] **Step 1: Swap the data source**

Replace the `useLeads` import/usage with `useSalesKanbanColumns`. Build the owner-name map once and an `ownerNameFor` callback. Keep all filter/sort/search state, drag, and convert logic. Key changes:

```tsx
// imports: remove `useLeads` AND its `type { LeadRow }` import (both now unused); add:
import { useSalesKanbanColumns } from './hooks/useSalesKanbanColumns';
import { isCollapsedStage } from './salesKanbanColumns';
```

After `salesStages` is computed, drive the board off the hook (note: stages must be loaded first; pass them in):

```tsx
  const kanbanStages = salesStages.map((s) => ({ id: s.id, code: s.code }));
  const { data: columns = [], isLoading } = useSalesKanbanColumns(kanbanStages, {
    ...(typeof filter.ownerId === 'string' ? { ownerId: filter.ownerId } : {}),
    ...(source ? { source } : {}),
    search,
    sortBy,
  });
  const columnsByStage = new Map(columns.map((c) => [c.stageId, c]));

  const ownerName = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
  const nameFor = (userId: string | null) =>
    userId ? (ownerName.get(userId) ?? '') : '';

  const activeLead =
    activeId
      ? (columns.flatMap((c) => c.leads).find((l) => l.id === activeId) ?? null)
      : null;
```

Delete the now-dead client-side machinery: the `searchNorm`/`filteredLeads` block, `valueOf`, `compare`, and the `leadsByStage` loop (ordering + filtering + search now happen server-side in the hook). `salesStages` must be computed **before** the `isLoading` early return (move the `salesStages`/`kanbanStages` lines above `if (isLoading)`).

- [ ] **Step 2: Render columns from the hook**

```tsx
          {salesStages.map((s) => {
            const col = columnsByStage.get(s.id);
            return (
              <SalesKanbanColumn
                key={s.id}
                stageId={s.id}
                stageLabel={(s.display_names as { en: string; el: string })[lang]}
                leads={col?.leads ?? []}
                total={col?.total ?? 0}
                collapsed={isCollapsedStage(s.code)}
                overflowHref={`/sales/leads?stage=${s.id}${
                  typeof filter.ownerId === 'string' ? `&owner=${filter.ownerId}` : ''
                }`}
                nameFor={nameFor}
                locked={isStageMoveBlocked(s, userId)}
              />
            );
          })}
```

And the drag overlay passes the owner name:
```tsx
        <DragOverlay>
          {activeLead ? (
            <SalesKanbanCard
              lead={activeLead}
              ownerName={nameFor(activeLead.owner_user_id)}
              wonByName={nameFor(activeLead.won_by_user_id)}
            />
          ) : null}
        </DragOverlay>
```

- [ ] **Step 3: Type-check + run the sales test suite**

Run: `npx tsc --noEmit && npx vitest run src/features/sales`
Expected: no type errors; sales tests PASS.

- [ ] **Step 4: Manual smoke (localhost)**

Run: `npm run dev`. As admin open `/sales/kanban`. Expected: board loads quickly; active columns show ≤50 cards with correct `(total)` headers and a "+N more" link where total>50; Not Interested / Dead End are narrow collapsed columns with an "Open N in list" link and **no cards**; dragging a card between active columns (and onto a collapsed column) still moves/saves; "Won" still converts. No tab freeze.

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/SalesKanbanPage.tsx
git commit -m "perf(sales): cap kanban to top-N per active stage; collapse dead stages"
```

---

### Task 7: Leads list — paginate the render

**Files:**
- Modify: `src/features/leads/LeadsListPage.tsx`

The crash on `/sales/leads` is rendering ~4,000 `LeadRowEditor` rows. Keep loading all (CSV export + client filter/sort/counts depend on the full set) but render one page at a time, and honor `?stage`/`?owner` from the kanban links.

- [ ] **Step 1: Read URL params for initial filters + add page state**

Add imports and state:
```tsx
import { useSearchParams } from 'react-router-dom';
const PAGE_SIZE = 50;
```
Inside the component, after the existing `useState` block:
```tsx
  const [params] = useSearchParams();
  const [statusId, setStatusId] = useState<string>(params.get('stage') || ALL);
  const [ownerId, setOwnerId] = useState<string>(params.get('owner') || ALL);
  const [page, setPage] = useState(0);
```
(Remove the original `statusId`/`ownerId` `useState` lines so these replace them.)

- [ ] **Step 2: Reset to page 0 whenever the filtered set changes, and slice**

After `rows` is computed:
```tsx
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
```
Add an effect so changing filters returns to the first page:
```tsx
  useEffect(() => { setPage(0); }, [search, statusId, ownerId, sort]);
```
(Add `useEffect` to the `react` import.)

- [ ] **Step 3: Render `pageRows` (not `rows`) and add a pager**

Change the table body map from `rows.map(...)` to `pageRows.map(...)`. "Select all" should still select the full filtered set (`rows`), so leave `selectAll`/the header checkbox using `rows`. Below the table add:
```tsx
      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
            ‹ {t('pager.prev')}
          </Button>
          <span>{t('pager.status', { page: safePage + 1, total: pageCount, count: rows.length })}</span>
          <Button variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
            {t('pager.next')} ›
          </Button>
        </div>
      )}
```

- [ ] **Step 4: Add pager i18n keys**

In `src/i18n/locales/en/leads.json` add a `pager` block:
```json
"pager": { "prev": "Prev", "next": "Next", "status": "Page {{page}} of {{total}} · {{count}} leads" }
```
In `src/i18n/locales/el/leads.json`:
```json
"pager": { "prev": "Προηγούμενη", "next": "Επόμενη", "status": "Σελίδα {{page}} από {{total}} · {{count}} leads" }
```

- [ ] **Step 5: Type-check + manual smoke**

Run: `npx tsc --noEmit`. Then in `npm run dev`, open `/sales/leads`. Expected: only 50 rows render at a time; pager moves pages; changing a filter resets to page 1; the kanban "open in list" links land with the stage/owner pre-filtered; CSV export still exports the full filtered set.

- [ ] **Step 6: Commit**

```bash
git add src/features/leads/LeadsListPage.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "perf(leads): paginate the leads-list render + honor stage/owner URL params"
```

---

### Task 8: Full verification + push

- [ ] **Step 1: Full type-check, lint, tests, build**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 2: Push**

```bash
git push origin main
```
(Per project convention: push directly to main, no PR.)

---

## Changes / Revert

**What changes**
- New DB function `public.sales_kanban_counts`, generated column `leads.estimated_total_value`, three partial indexes (migration `20260618000004`).
- Sales kanban loads ≤50 leads per active stage + counts (was: every lead); dead stages collapse to a count + list link; owner name lifted out of the card.
- Leads list renders 50 rows/page (was: all rows); honors `?stage`/`?owner` params.

**How to revert**
- DB: run the `-- ROLLBACK:` block in `20260618000004_sales_kanban_counts.sql`.
- Code: `git revert` the Task 3–7 commits (each task is one atomic commit). Reverting only the page/column/card commits restores the old all-leads board without touching the DB.

## Decisions baked in (tunable)
- **Cap = 50 cards/active column** (`KANBAN_COLUMN_LIMIT`). Raise/lower in `salesKanbanColumns.ts`.
- **Collapsed stages = `not_interested`, `dead_end`** (`COLLAPSED_STAGE_CODES`). Add/remove codes there.
- Collapsed columns remain **drop targets** (so "drag to Not Interested / Dead End" still works) but mount zero cards.
- Search & sort run **server-side** in the hook + counts RPC, so totals and the visible top-50 stay consistent.

## Out of scope (deliberately)
- Virtualizing within a column — unnecessary once each column is capped at 50.
- Server-side pagination of the leads list — the full set is needed for CSV export + client sort/filter; render-pagination removes the crash with far less risk.
