# Dashboard: "Won" = deals (not won-stage leads) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Make the dashboard's conversion metrics reflect reality — a "win" is a **deal**, not a lead sitting in the `won` stage. Lead/deal populations are disjoint (deals came from ClickUp; leads are Meta), so the dashboard separates them: wins from `deals`, volume/source from `leads`. Win rate is dropped (Option A).

**Architecture:** Add a `useDashboardDeals` hook + a pure `dealsByPerson` aggregator. Rewire `DashboardPage` tiles/charts/tables. Financial widgets (revenue trend, Collected, Contracted MRR) are untouched — they self-heal as accounting re-enters payments.

**Tech Stack:** React + react-query + recharts; Vitest for the pure aggregator. No DB/schema changes.

**Key facts (verified 2026-06-22):** 474 active deals; won-date = `coalesce(invoiced_date, actual_close_date)` (all set, all 2026); `won_by_user_id` set on 419; deals have **no** `lead_source`; deal amounts partial (15 one-time, 140 monthly).

---

### Task 1: `dealsByPerson` aggregator (pure, TDD)

**Files:** Modify `src/features/dashboard/aggregate.ts`; Test `src/features/dashboard/aggregate.test.ts`

- [ ] **Step 1: Write the failing test** (append to aggregate.test.ts)

```ts
import { dealsByPerson, type DealLite } from './aggregate';

describe('dealsByPerson', () => {
  it('groups deal count + value by person, sorted by deal count desc', () => {
    const deals: DealLite[] = [
      { person: 'Maria', oneTime: 100, monthly: 50 },
      { person: 'Maria', oneTime: 0, monthly: 30 },
      { person: 'Nikos', oneTime: 200, monthly: 0 },
    ];
    const rows = dealsByPerson(deals);
    expect(rows[0]).toEqual({ key: 'Maria', deals: 2, oneTime: 100, monthly: 80 });
    expect(rows[1]).toEqual({ key: 'Nikos', deals: 1, oneTime: 200, monthly: 0 });
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `npx vitest run src/features/dashboard/aggregate.test.ts` → FAIL (`dealsByPerson` not exported).

- [ ] **Step 3: Implement** (append to aggregate.ts)

```ts
export type DealLite = { person: string; oneTime: number; monthly: number };
export type DealPersonRow = { key: string; deals: number; oneTime: number; monthly: number };

export function dealsByPerson(deals: DealLite[]): DealPersonRow[] {
  const byKey = new Map<string, DealPersonRow>();
  for (const d of deals) {
    let row = byKey.get(d.person);
    if (!row) { row = { key: d.person, deals: 0, oneTime: 0, monthly: 0 }; byKey.set(d.person, row); }
    row.deals += 1;
    row.oneTime += d.oneTime;
    row.monthly += d.monthly;
  }
  return [...byKey.values()].sort((a, b) => b.deals - a.deals);
}
```

- [ ] **Step 4: Run it, watch it pass.**

- [ ] **Step 5: Commit** — `git add src/features/dashboard/aggregate.ts src/features/dashboard/aggregate.test.ts && git commit -m "feat(dashboard): dealsByPerson aggregator"`

---

### Task 2: `useDashboardDeals` hook

**Files:** Modify `src/features/dashboard/hooks/useDashboardData.ts`; Test same file's spec if present (else none — it's a thin query, covered by manual + page).

- [ ] **Step 1: Add the hook** (append to useDashboardData.ts)

```ts
export type DashboardDeal = {
  won_by_user_id: string | null;
  one_time_value: number | null;
  recurring_monthly_value: number | null;
  invoiced_date: string | null;
  actual_close_date: string | null;
};

/** Active deals = the wins. Won-date = invoiced_date ?? actual_close_date (filtered in the page). */
export function useDashboardDeals() {
  return useQuery({
    queryKey: ['dashboard-deals'] as const,
    queryFn: async (): Promise<DashboardDeal[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select('won_by_user_id, one_time_value, recurring_monthly_value, invoiced_date, actual_close_date')
        .eq('archived', false);
      if (error) throw new Error(error.message);
      return (data ?? []) as DashboardDeal[];
    },
  });
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → passes.

- [ ] **Step 3: Commit** — `git add ... && git commit -m "feat(dashboard): useDashboardDeals hook"`

---

### Task 3: Rewire DashboardPage (tiles, by-person chart, tables)

**Files:** Modify `src/features/dashboard/DashboardPage.tsx`

- [ ] **Step 1: Compute deals-in-range + per-person** (inside the component, after existing hooks)

```ts
const deals = useDashboardDeals();
const dealLites: DealLite[] = useMemo(() => {
  const inRange = (d: DashboardDeal) => {
    const won = d.invoiced_date ?? d.actual_close_date;
    return !!won && won >= range.from && won <= range.to;
  };
  return (deals.data ?? []).filter(inRange).map((d) => ({
    person: ownerName(d.won_by_user_id),
    oneTime: Number(d.one_time_value) || 0,
    monthly: Number(d.recurring_monthly_value) || 0,
  }));
}, [deals.data, range, ownerName]);

const wonByPerson = useMemo(() => dealsByPerson(dealLites), [dealLites]);
const wonTotals = useMemo(() => ({
  count: dealLites.length,
  oneTime: dealLites.reduce((s, d) => s + d.oneTime, 0),
  monthly: dealLites.reduce((s, d) => s + d.monthly, 0),
}), [dealLites]);
```

- [ ] **Step 2: Replace the tiles block** — 5 tiles: Leads received, Deals won, Won value, Contracted MRR, Collected. Remove the Win-rate tile and the leads `totals.won`/`winRate` usage.

```tsx
<Tile label={t('dashboard.leads_received')} value={String(totals.created)} icon={TrendingUp} />
<Tile label={t('dashboard.deals_won')} value={String(wonTotals.count)} icon={Target} accent="success" />
<Tile label={t('dashboard.won_value')}
  value={`€${wonTotals.oneTime.toFixed(0)}`}
  hint={wonTotals.monthly > 0 ? `+€${wonTotals.monthly.toFixed(0)}/mo` : undefined}
  icon={TrendingUp} accent="success" />
<Tile label={t('dashboard.contracted_mrr')} value={`€${(contractedMrr.data ?? 0).toFixed(0)}`} icon={RefreshCw} accent="primary" />
<Tile label={t('dashboard.collected')} value={`€${collectedInRange.toFixed(0)}`} hint={t('dashboard.collected_hint')} icon={Wallet} accent="warning" />
```

- [ ] **Step 3: Replace "conversion by person" chart** with deals-won-by-person bar (single series = deal count).

```tsx
const wonChartData = wonByPerson.map((r) => ({ name: r.key, [t('dashboard.deals_won')]: r.deals }));
// <ChartCard title={t('dashboard.deals_won_by_person')}> ... <Bar dataKey={t('dashboard.deals_won')} fill={CHART.won} radius={[0,4,4,0]} /> ...
```

- [ ] **Step 4: Replace the two tables.** Table A = deals won by person (person | deals | value). Table B = leads received by source (reuse `bySource` from `cohortStats`, render the `total` column only, relabel header to "Leads received").

```tsx
// New WonByPersonTable: columns key | deals | €oneTime (+€monthly/mo)
// Keep CohortTable for source but render a 2-col variant, OR add a small LeadsBySourceTable showing key + total.
```
Add a focused `WonByPersonTable` component in the file (mirrors `CohortTable` styling) and a `LeadsBySourceTable` (key + count). Remove the old won/lost/open columns.

- [ ] **Step 5: Remove now-dead code** — the `totals.won/winRate`, `byOwner` lead cohort, `ownerChartData`, and the win-rate tile. Keep `bySource` (for leads-received) and `leadLites` (drives `bySource` + `totals.created`).

- [ ] **Step 6: Typecheck + lint** — `npm run typecheck && npx eslint src/features/dashboard/DashboardPage.tsx --max-warnings=0`.

- [ ] **Step 7: Commit.**

---

### Task 4: i18n (en + el)

**Files:** Modify `src/i18n/locales/en/translation.json` and `src/i18n/locales/el/translation.json` (whichever namespace holds `dashboard.*` — grep `"leads_created"`).

- [ ] **Step 1: Add keys** under `dashboard`: `leads_received`, `deals_won`, `won_value`, `deals_won_by_person`, `leads_by_source`, `deals` (column). Keep existing `collected`, `contracted_mrr`, `revenue_trend`, etc. Remove/keep `win_rate` keys (leave for safety).
  - en: "Leads received", "Deals won", "Won value", "Deals won by person", "Leads by source", "Deals".
  - el: "Νέα leads", "Deals που κερδήθηκαν", "Αξία", "Deals ανά άτομο", "Leads ανά πηγή", "Deals".

- [ ] **Step 2: Run the full suite** — `npm run test:run` (dashboard aggregate tests + nothing else broken).

- [ ] **Step 3: Build** — `npm run build`.

- [ ] **Step 4: Commit + push.**

---

### Task 5: Verify live + record

- [ ] **Step 1:** Confirm via SQL the "Deals won" number for the default range matches the tile (count of active deals with `coalesce(invoiced_date,actual_close_date)` in range ≈ 474).
- [ ] **Step 2:** Memory note (dashboard won = deals; financial widgets pending accounting rebuild) + MEMORY.md pointer.

## Self-Review
- **Spec coverage:** won=deals → Tasks 1-3; accounting deals counted as won → won-date coalesce includes all 474 (all carry accounting stage) ✓; drop win rate → Task 3 Step 2/5; by-source stays leads (deals lack source) → Task 3 Step 4. All covered.
- **Placeholders:** none — code given. Task 3 Step 4 references new components `WonByPersonTable`/`LeadsBySourceTable` modeled on existing `CohortTable` (same file) — implementer mirrors its markup.
- **Type consistency:** `DealLite`/`DealPersonRow` (Task 1) used in Task 3; `useDashboardDeals`/`DashboardDeal` (Task 2) used in Task 3.
- **Caveat to surface in UI/notes:** "Won value" is partial (most deals have €0 amount) — expected, not a bug.
