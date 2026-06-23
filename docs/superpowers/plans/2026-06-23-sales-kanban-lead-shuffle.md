# Sales Kanban — Lead Shuffle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a control on `/sales/kanban` that re-distributes every lead in a chosen sales stage across the sales team — never back to the rep who currently owns it, as evenly as possible — and resets each shuffled lead to the **New Lead** stage.

**Architecture:** The hard part (a balanced, no-self-reassignment plan) lives in a pure, unit-tested TypeScript function `planLeadShuffle`. A React hook fetches the stage's leads + the sales pool, runs the planner, then calls an atomic admin-only Postgres RPC `apply_lead_shuffle` that re-checks each lead is still in the chosen stage, sets its owner, and moves it to New Lead. Each lead's owner/stage change is recorded automatically by the existing `leads_activity` trigger (attributed to the acting admin via `auth.uid()`), so there is no separate backup table.

**Tech Stack:** React 18 + TypeScript, TanStack Query, Supabase (Postgres RPC, RLS, `security definer`), react-i18next, vitest + @testing-library/react. DDL is applied to prod via the Supabase MCP `apply_migration` (Bash/API DDL is blocked by the safety classifier).

**Decisions locked with the product owner (2026-06-23):**
- **Shufflable stages:** `new_lead`, `no_answer`, `working_on_it`, `offer_sent`, `scheduled`, `hot`. Excludes `constant_na`, `unique_lead`, and the terminal stages `won` / `not_interested` / `dead_end`, plus converted leads.
- **Recipient pool:** reuse the existing `sales_pool_ids()` distribution pool (active sales group; already excludes paused / `exclude_from_lead_distribution` reps).
- **After shuffle:** reset every shuffled lead to the **New Lead** stage (even if it was further along, e.g. Hot/Offer Sent).
- **Audit:** no backup table — rely on the per-lead `activity_log` entry the existing trigger writes.

**Rule precedence note:** "no rep gets their own lead back" is a **hard** rule; "everyone gets the same number" is met whenever feasible. They only conflict in a pathological stage (e.g. one rep owns almost every lead in it). In that rare case `planLeadShuffle` keeps the no-self guarantee and gets as even as possible. For real, mixed-owner stages both hold exactly.

---

## File Structure

**Create:**
- `supabase/migrations/20260623120000_lead_shuffle.sql` — `lead_shuffle_pool()` + `apply_lead_shuffle()` RPCs (admin-only, security definer).
- `src/features/sales/leadShuffle.ts` — pure planner `planLeadShuffle` (the balanced, no-self algorithm). One responsibility: compute assignments.
- `src/features/sales/leadShuffle.test.ts` — unit tests for the planner.
- `src/features/sales/hooks/useShuffleStageLeads.ts` — orchestration hook (fetch → plan → apply → invalidate).
- `src/features/sales/SalesKanbanPage.test.tsx` — component test for the shuffle control + confirm flow.

**Modify:**
- `src/features/sales/SalesKanbanPage.tsx` — admin-only stage dropdown + Shuffle button + confirm dialog, wired to the hook.
- `src/i18n/locales/en/sales.json` — `kanban.shuffle.*` keys.
- `src/i18n/locales/el/sales.json` — `kanban.shuffle.*` keys (Greek).

**Reference (read-only, patterns mirrored):**
- `src/features/leads/hooks/useDistributeUnassigned.ts` — RPC hook + `.bind(supabase)` + invalidation pattern.
- `src/features/leads/LeadsListPage.tsx:158-167,397-407` — confirm-dialog flow for a bulk action.
- `src/features/leads/LeadsListPage.test.tsx` — component-test mocking conventions.
- `supabase/migrations/20260616124457_lead_distribution.sql` — `sales_pool_ids()`, admin-gated RPC pattern.

---

## Task 1: Database RPCs (`lead_shuffle_pool`, `apply_lead_shuffle`)

**Files:**
- Create: `supabase/migrations/20260623120000_lead_shuffle.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260623120000_lead_shuffle.sql` with exactly:

```sql
-- Admin "shuffle leads" for the sales kanban: re-distribute every lead in a
-- chosen stage across the active sales pool (never back to the same rep) and
-- reset them to New Lead. The distribution math runs client-side (unit tested);
-- these two RPCs expose the pool and apply the precomputed result atomically.

-- 1. Pool accessor for the client-side planner. Admin only. Same pool the
--    auto-distribution trigger uses (active sales group, minus excluded reps).
create or replace function public.lead_shuffle_pool()
returns uuid[] language plpgsql security definer set search_path = public stable as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'permission_denied';
  end if;
  return public.sales_pool_ids();
end $$;

revoke all on function public.lead_shuffle_pool() from public, anon;
grant execute on function public.lead_shuffle_pool() to authenticated;

-- 2. Apply a precomputed assignment. Admin only, atomic. Each lead is moved to
--    New Lead and reassigned, but ONLY if it is still in the chosen stage
--    (guards against a lead moving between fetch and apply). Returns the number
--    of leads actually updated. The leads_activity trigger logs each change,
--    attributed to the calling admin via auth.uid().
create or replace function public.apply_lead_shuffle(
  p_stage_code text,
  p_assignments jsonb
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_from_stage uuid;
  v_new_lead_stage uuid;
  v_count int := 0;
  r record;
begin
  if not public.current_user_is_admin() then
    raise exception 'permission_denied';
  end if;

  if p_stage_code not in
       ('new_lead','no_answer','working_on_it','offer_sent','scheduled','hot') then
    raise exception 'stage_not_shufflable';
  end if;

  select id into v_from_stage
    from public.pipeline_stages where board = 'sales' and code = p_stage_code;
  if v_from_stage is null then
    raise exception 'unknown_stage';
  end if;

  select id into v_new_lead_stage
    from public.pipeline_stages where board = 'sales' and code = 'new_lead';

  for r in
    select (e->>'lead_id')::uuid as lead_id,
           (e->>'owner_user_id')::uuid as owner_user_id
      from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) e
  loop
    update public.leads
       set owner_user_id = r.owner_user_id,
           stage_id = v_new_lead_stage
     where id = r.lead_id
       and stage_id = v_from_stage
       and archived = false
       and converted_at is null;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

revoke all on function public.apply_lead_shuffle(text, jsonb) from public, anon;
grant execute on function public.apply_lead_shuffle(text, jsonb) to authenticated;

-- ROLLBACK:
-- drop function if exists public.apply_lead_shuffle(text, jsonb);
-- drop function if exists public.lead_shuffle_pool();
```

- [ ] **Step 2: Apply the migration to prod via the Supabase MCP**

Use the MCP tool (DDL via Bash/curl is blocked by the safety classifier):

`mcp__plugin_supabase_supabase__apply_migration` with:
- `name`: `lead_shuffle`
- `query`: the full SQL from Step 1.

Expected: success, no error.

- [ ] **Step 3: Verify the functions exist and the admin gate works**

Use `mcp__plugin_supabase_supabase__execute_sql` to run:

```sql
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('lead_shuffle_pool','apply_lead_shuffle')
order by proname;
```

Expected: two rows — `apply_lead_shuffle | p_stage_code text, p_assignments jsonb` and `lead_shuffle_pool |` (no args).

Then run (MCP executes as service role, so `auth.uid()` is null → not admin):

```sql
select public.apply_lead_shuffle('no_answer', '[]'::jsonb);
```

Expected: ERROR `permission_denied` — this confirms the admin gate fires. (Positive end-to-end behavior is validated through the UI as a real admin in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260623120000_lead_shuffle.sql
git commit -m "feat(lead-shuffle): apply_lead_shuffle + lead_shuffle_pool RPCs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure planner `planLeadShuffle` (the algorithm)

**Files:**
- Create: `src/features/sales/leadShuffle.ts`
- Test: `src/features/sales/leadShuffle.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/sales/leadShuffle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planLeadShuffle, type ShuffleLead } from './leadShuffle';

const pool = ['r1', 'r2', 'r3'];

function counts(assignments: { newOwnerId: string }[]) {
  const m = new Map<string, number>();
  for (const a of assignments) m.set(a.newOwnerId, (m.get(a.newOwnerId) ?? 0) + 1);
  return m;
}

function cyclicLeads(n: number): ShuffleLead[] {
  return Array.from({ length: n }, (_, i) => ({ id: `l${i}`, ownerId: pool[i % 3] }));
}

describe('planLeadShuffle', () => {
  it('throws when fewer than two reps are in the pool', () => {
    expect(() => planLeadShuffle([{ id: 'l1', ownerId: null }], ['r1'])).toThrow(
      'shuffle_needs_two_reps',
    );
  });

  it('returns an assignment for every lead, exactly once', () => {
    const out = planLeadShuffle(cyclicLeads(3), pool);
    expect(out.map((a) => a.leadId).sort()).toEqual(['l0', 'l1', 'l2']);
  });

  it('never returns a lead to its current owner', () => {
    const leads = cyclicLeads(30);
    const ownerOf = new Map(leads.map((l) => [l.id, l.ownerId]));
    for (const a of planLeadShuffle(leads, pool)) {
      expect(a.newOwnerId).not.toBe(ownerOf.get(a.leadId));
    }
  });

  it('distributes evenly when the count divides the pool size', () => {
    const c = counts(planLeadShuffle(cyclicLeads(30), pool));
    expect([...c.values()].sort((a, b) => a - b)).toEqual([10, 10, 10]);
  });

  it('keeps the per-rep spread within one when there is a remainder', () => {
    const vals = [...counts(planLeadShuffle(cyclicLeads(31), pool)).values()];
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
  });

  it('handles leads that currently have no owner', () => {
    const leads: ShuffleLead[] = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, ownerId: null }));
    const c = counts(planLeadShuffle(leads, pool));
    expect([...c.values()].sort((a, b) => a - b)).toEqual([2, 2, 2]);
  });

  it('still guarantees no-self even when one rep owns every lead in the stage', () => {
    const leads: ShuffleLead[] = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, ownerId: 'r1' }));
    for (const a of planLeadShuffle(leads, pool)) {
      expect(a.newOwnerId).not.toBe('r1');
    }
  });

  it('is deterministic for the same input', () => {
    const leads = cyclicLeads(17);
    expect(planLeadShuffle(leads, pool)).toEqual(planLeadShuffle(leads, pool));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/sales/leadShuffle.test.ts`
Expected: FAIL — `Failed to resolve import "./leadShuffle"` / `planLeadShuffle is not a function`.

- [ ] **Step 3: Implement the planner**

Create `src/features/sales/leadShuffle.ts`:

```ts
export interface ShuffleLead {
  id: string;
  /** Current owner (the rep the lead must NOT be returned to), or null if unassigned. */
  ownerId: string | null;
}

export interface ShuffleAssignment {
  leadId: string;
  newOwnerId: string;
}

/**
 * Re-distribute a set of leads across the sales pool so that:
 *  - no lead is given back to the rep who currently owns it (hard rule), and
 *  - every rep receives as close to an equal share as possible.
 *
 * Strategy: cluster leads by current owner, lay down a balanced round-robin base
 * assignment (per-rep counts differ by at most 1), then repair any self-assignment
 * by swapping its target with another lead's. A swap preserves both reps' counts,
 * so balance survives the repair. In the rare case where no count-preserving swap
 * exists (e.g. one rep owns nearly every lead in the stage), the conflicting lead
 * is moved to the least-loaded non-self rep — trading a small imbalance for the
 * no-self guarantee, which is the higher-priority rule.
 *
 * Deterministic: same input -> same output (no randomness), so it is unit testable
 * and the result is reproducible.
 *
 * @throws Error('shuffle_needs_two_reps') if the pool has fewer than two reps.
 */
export function planLeadShuffle(leads: ShuffleLead[], pool: string[]): ShuffleAssignment[] {
  if (pool.length < 2) {
    throw new Error('shuffle_needs_two_reps');
  }
  const n = pool.length;

  // Cluster by current owner so the round-robin spreads each owner's leads across
  // different reps; tiebreak by id for a stable, deterministic order.
  const ordered = [...leads].sort((a, b) => {
    const ao = a.ownerId ?? '';
    const bo = b.ownerId ?? '';
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  // Balanced base assignment (counts differ by at most 1).
  const assigned: string[] = ordered.map((_, k) => pool[k % n]);

  const isConflict = (k: number) => assigned[k] === ordered[k].ownerId;

  for (let k = 0; k < ordered.length; k++) {
    if (!isConflict(k)) continue;

    let swapped = false;
    for (let j = 0; j < ordered.length; j++) {
      if (j === k) continue;
      // After a swap, lead k takes assigned[j] and lead j takes assigned[k].
      if (assigned[j] === ordered[k].ownerId) continue; // k would still conflict
      if (assigned[k] === ordered[j].ownerId) continue; // j would newly conflict
      [assigned[k], assigned[j]] = [assigned[j], assigned[k]];
      swapped = true;
      break;
    }

    if (!swapped) {
      // No count-preserving swap exists: move to the least-loaded non-self rep.
      const load = new Map<string, number>(pool.map((p) => [p, 0]));
      for (const a of assigned) load.set(a, (load.get(a) ?? 0) + 1);
      let best: string | null = null;
      for (const p of pool) {
        if (p === ordered[k].ownerId) continue;
        if (best === null || load.get(p)! < load.get(best)!) best = p;
      }
      if (best) assigned[k] = best;
    }
  }

  return ordered.map((lead, k) => ({ leadId: lead.id, newOwnerId: assigned[k] }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/sales/leadShuffle.test.ts`
Expected: PASS — 8 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/leadShuffle.ts src/features/sales/leadShuffle.test.ts
git commit -m "feat(lead-shuffle): planLeadShuffle balanced no-self planner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Orchestration hook `useShuffleStageLeads`

**Files:**
- Create: `src/features/sales/hooks/useShuffleStageLeads.ts`

This hook is thin glue (fetch → plan → apply → invalidate); the algorithm it depends on is already covered by Task 2 and the RPC by Task 1. We verify it by typecheck + the component test in Task 5, so there is no separate unit test here.

- [ ] **Step 1: Implement the hook**

Create `src/features/sales/hooks/useShuffleStageLeads.ts`:

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { planLeadShuffle } from '../leadShuffle';

// `.bind(supabase)` is required: supabase-js's `from()`/`rpc()` read `this.rest`,
// so capturing them bare loses the binding and throws "Cannot read properties of
// undefined (reading 'rest')" before any request is sent.
const from = supabase.from.bind(supabase);
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type ShuffleStageInput = { stageId: string; stageCode: string };

export function useShuffleStageLeads() {
  const qc = useQueryClient();
  return useMutation<number, DefaultError, ShuffleStageInput>({
    mutationFn: captureMutation<ShuffleStageInput, number>(
      'leads',
      'shuffle_stage',
      async ({ stageId, stageCode }) => {
        // 1. Every lead currently in the chosen stage (admin RLS sees all).
        const { data: leadRows, error: leadsErr } = await from('leads')
          .select('id, owner_user_id')
          .eq('stage_id', stageId)
          .eq('archived', false)
          .is('converted_at', null);
        if (leadsErr) throw new Error(leadsErr.message);
        const leads = (leadRows ?? []) as { id: string; owner_user_id: string | null }[];
        if (leads.length === 0) return 0;

        // 2. The sales rotation pool (same pool auto-distribution uses).
        const { data: poolData, error: poolErr } = await rpc('lead_shuffle_pool');
        if (poolErr) throw new Error(poolErr.message);
        const pool = (poolData ?? []) as string[];

        // 3. Balanced, no-self assignment computed client-side (unit tested).
        const assignments = planLeadShuffle(
          leads.map((l) => ({ id: l.id, ownerId: l.owner_user_id })),
          pool,
        ).map((a) => ({ lead_id: a.leadId, owner_user_id: a.newOwnerId }));

        // 4. Apply atomically; the RPC resets each lead to New Lead and re-checks
        //    it is still in the chosen stage (race guard). Returns rows updated.
        const { data, error } = await rpc('apply_lead_shuffle', {
          p_stage_code: stageCode,
          p_assignments: assignments,
        });
        if (error) throw new Error(error.message);
        return (data as number | null) ?? 0;
      },
    ),
    // Resolve only after refetch so the caller's success alert shows fresh counts.
    // The leads/kanban-counts/kanban-column query keys all start with 'leads',
    // so invalidating ['leads'] refreshes the whole board.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.leads() }),
  });
}
```

- [ ] **Step 2: Typecheck the new file**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors. (The RPC names are accessed through the cast `rpc`, so regenerated Supabase types are not required.)

- [ ] **Step 3: Commit**

```bash
git add src/features/sales/hooks/useShuffleStageLeads.ts
git commit -m "feat(lead-shuffle): useShuffleStageLeads hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: i18n keys

**Files:**
- Modify: `src/i18n/locales/en/sales.json`
- Modify: `src/i18n/locales/el/sales.json`

- [ ] **Step 1: Add the English keys**

In `src/i18n/locales/en/sales.json`, replace the `kanban` block (lines 2–12) so it gains a `shuffle` section. The full new `kanban` block:

```json
  "kanban": {
    "title": "Sales pipeline",
    "empty_column": "Drop leads here",
    "locked_move": "Only Manolis can move leads into this column.",
    "load_more": "Load more",
    "loading_more": "Loading…",
    "card": {
      "value": "Value",
      "monthly": "/mo"
    },
    "shuffle": {
      "stage_label": "Stage to shuffle",
      "button": "Shuffle ({{count}})",
      "confirm_title": "Shuffle leads?",
      "confirm_body": "Reassign {{count}} lead(s) in \"{{stage}}\" across the sales team and reset them to New Lead. No rep gets a lead back that they already own. This can't be undone.",
      "confirm_cta": "Shuffle",
      "done": "Shuffled {{count}} lead(s).",
      "errors": {
        "shuffle_needs_two_reps": "Need at least two active sales reps to shuffle.",
        "permission_denied": "Only admins can shuffle leads.",
        "stage_not_shufflable": "This stage can't be shuffled.",
        "unknown_stage": "Stage not found."
      }
    }
  },
```

- [ ] **Step 2: Add the Greek keys**

In `src/i18n/locales/el/sales.json`, replace the `kanban` block (lines 2–12) with:

```json
  "kanban": {
    "title": "Pipeline Πωλήσεων",
    "empty_column": "Σύρετε leads εδώ",
    "locked_move": "Μόνο ο Μανώλης μπορεί να μετακινεί leads σε αυτή τη στήλη.",
    "load_more": "Φόρτωση περισσότερων",
    "loading_more": "Φόρτωση…",
    "card": {
      "value": "Αξία",
      "monthly": "/μήνα"
    },
    "shuffle": {
      "stage_label": "Στήλη προς ανακατανομή",
      "button": "Ανακατανομή ({{count}})",
      "confirm_title": "Ανακατανομή leads;",
      "confirm_body": "Ανάθεση {{count}} lead από τη στήλη «{{stage}}» στην ομάδα πωλήσεων και επαναφορά τους σε New Lead. Κανένας πωλητής δεν παίρνει πίσω lead που ήδη έχει. Δεν αναιρείται.",
      "confirm_cta": "Ανακατανομή",
      "done": "Ανακατανεμήθηκαν {{count}} leads.",
      "errors": {
        "shuffle_needs_two_reps": "Χρειάζονται τουλάχιστον δύο ενεργοί πωλητές για ανακατανομή.",
        "permission_denied": "Μόνο διαχειριστές μπορούν να κάνουν ανακατανομή.",
        "stage_not_shufflable": "Αυτή η στήλη δεν μπορεί να ανακατανεμηθεί.",
        "unknown_stage": "Η στήλη δεν βρέθηκε."
      }
    }
  },
```

- [ ] **Step 3: Verify both JSON files are valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/sales.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/el/sales.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no JSON syntax error).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/sales.json src/i18n/locales/el/sales.json
git commit -m "feat(lead-shuffle): i18n keys for the shuffle control

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire the shuffle control into `SalesKanbanPage`

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx`
- Test: `src/features/sales/SalesKanbanPage.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/features/sales/SalesKanbanPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const { shuffleMutateAsync } = vi.hoisted(() => ({
  shuffleMutateAsync: vi.fn().mockResolvedValue(4),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } | null }) => unknown) =>
    sel({ isAdmin: true, user: { id: 'admin-1' } }),
}));

const stage = (code: string, position: number) => ({
  id: `stage-${code}`,
  board: 'sales',
  code,
  display_names: { en: code, el: code },
  position,
  archived: false,
});

vi.mock('@/features/stages/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({
    data: [stage('new_lead', 10), stage('no_answer', 20), stage('hot', 70), stage('won', 80)],
    isLoading: false,
  }),
}));

vi.mock('./hooks/useSalesKanbanCounts', () => ({
  useSalesKanbanCounts: () => ({ data: new Map([['stage-no_answer', 12]]) }),
}));

vi.mock('./hooks/useShuffleStageLeads', () => ({
  useShuffleStageLeads: () => ({ mutateAsync: shuffleMutateAsync, isPending: false }),
}));

// Stub the heavy pieces unrelated to the shuffle control.
vi.mock('./useSalesKanbanRealtime', () => ({ useSalesKanbanRealtime: () => undefined }));
vi.mock('@/features/leads/hooks/useMoveLeadStage', () => ({
  useMoveLeadStage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/leads/hooks/useConvertLead', () => ({
  useConvertLead: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({
  useAssignableOwners: () => ({ data: [] }),
}));
vi.mock('./SalesKanbanColumn', () => ({ SalesKanbanColumnContainer: () => null }));
vi.mock('./SalesKanbanCard', () => ({ SalesKanbanCard: () => null }));
vi.mock('@/features/leads/CreateLeadDialog', () => ({ CreateLeadDialog: () => null }));
vi.mock('@/features/saved_filters/SavedFiltersBar', () => ({ SavedFiltersBar: () => null }));

import { SalesKanbanPage } from './SalesKanbanPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <SalesKanbanPage />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SalesKanbanPage shuffle control', () => {
  beforeEach(() => {
    shuffleMutateAsync.mockClear();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('clicking Shuffle opens a confirm dialog instead of shuffling immediately', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /shuffle/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(shuffleMutateAsync).not.toHaveBeenCalled();
  });

  it('confirming the dialog shuffles the selected stage', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /shuffle/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^shuffle$/i }));
    expect(shuffleMutateAsync).toHaveBeenCalledWith({
      stageId: 'stage-no_answer',
      stageCode: 'no_answer',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/sales/SalesKanbanPage.test.tsx`
Expected: FAIL — no button matching `/shuffle/i` (the control doesn't exist yet), and the `./hooks/useShuffleStageLeads` mock target may report "module not found" only if the file is missing — it exists from Task 3, so the failure is the missing button.

- [ ] **Step 3: Add the shuffle constant and imports**

In `src/features/sales/SalesKanbanPage.tsx`, add two imports after the existing `CreateLeadDialog` import (line 26):

```ts
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useShuffleStageLeads } from './hooks/useShuffleStageLeads';
```

Then add this module-level constant immediately after the imports block (before `export function SalesKanbanPage()`):

```ts
const SHUFFLABLE_CODES = [
  'new_lead',
  'no_answer',
  'working_on_it',
  'offer_sent',
  'scheduled',
  'hot',
] as const;
```

- [ ] **Step 4: Add hook + state + derived values**

In `SalesKanbanPage`, after the existing line `const convert = useConvertLead();` (line 52) add:

```ts
  const shuffle = useShuffleStageLeads();
  const [shuffleCode, setShuffleCode] = useState<string>('no_answer');
  const [confirmShuffle, setConfirmShuffle] = useState(false);
```

Then, immediately after the `const { data: counts } = useSalesKanbanCounts(columnFilter);` line (line 67), add the derived values (they need `salesStages` from line 55 and `counts`):

```ts
  const shufflableStages = salesStages.filter((s) =>
    (SHUFFLABLE_CODES as readonly string[]).includes(s.code),
  );
  const shuffleStage = shufflableStages.find((s) => s.code === shuffleCode) ?? shufflableStages[0];
  const shuffleCount = shuffleStage ? (counts?.get(shuffleStage.id) ?? 0) : 0;

  async function onConfirmShuffle() {
    if (!shuffleStage) return;
    try {
      const n = await shuffle.mutateAsync({ stageId: shuffleStage.id, stageCode: shuffleStage.code });
      alert(t('kanban.shuffle.done', { count: n }));
    } catch (e) {
      const msg = (e as Error).message;
      alert(t(`kanban.shuffle.errors.${msg}`, { defaultValue: msg }));
    } finally {
      setConfirmShuffle(false);
    }
  }
```

Note: `onConfirmShuffle` is declared after the `if (isLoading) return …` guard at line 73 in the current file. Place this block BEFORE that guard (i.e. right after the `counts` line at 67) so it is always defined. The existing `onDragStart`/`onDragEnd` are declared after the guard, which is fine because they are only referenced in JSX; `onConfirmShuffle` follows the same pattern, but defining it before the guard keeps all shuffle logic together — either position compiles.

- [ ] **Step 5: Add the dropdown + button to the header**

Replace the existing `PageHeader` block (lines 106–108):

```tsx
      <PageHeader title={t('kanban.title')}>
        <Button onClick={() => setCreateOpen(true)}>{tLeads('actions.create')}</Button>
      </PageHeader>
```

with:

```tsx
      <PageHeader title={t('kanban.title')}>
        {isAdmin && shufflableStages.length > 0 && (
          <div className="flex items-center gap-2">
            <FilterSelect
              value={shuffleStage?.code ?? ''}
              onChange={(e) => setShuffleCode(e.target.value)}
              title={t('kanban.shuffle.stage_label')}
            >
              {shufflableStages.map((s) => (
                <option key={s.id} value={s.code}>
                  {(s.display_names as { en: string; el: string })[lang]}
                </option>
              ))}
            </FilterSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={shuffleCount === 0 || shuffle.isPending}
              onClick={() => setConfirmShuffle(true)}
            >
              {t('kanban.shuffle.button', { count: shuffleCount })}
            </Button>
          </div>
        )}
        <Button onClick={() => setCreateOpen(true)}>{tLeads('actions.create')}</Button>
      </PageHeader>
```

- [ ] **Step 6: Add the confirm dialog**

Replace the closing of the component — the existing line 208:

```tsx
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
```

with:

```tsx
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={confirmShuffle}
        onOpenChange={(o) => {
          if (!o) setConfirmShuffle(false);
        }}
        title={t('kanban.shuffle.confirm_title')}
        description={t('kanban.shuffle.confirm_body', {
          count: shuffleCount,
          stage: shuffleStage ? (shuffleStage.display_names as { en: string; el: string })[lang] : '',
        })}
        confirmLabel={t('kanban.shuffle.confirm_cta')}
        onConfirm={onConfirmShuffle}
        pending={shuffle.isPending}
      />
```

- [ ] **Step 7: Run the component test to verify it passes**

Run: `npx vitest run src/features/sales/SalesKanbanPage.test.tsx`
Expected: PASS — 2 passing tests.

- [ ] **Step 8: Run the full check (typecheck + lint + tests)**

Run: `npx tsc --noEmit && npx vitest run src/features/sales/`
Expected: no type errors; all sales tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/features/sales/SalesKanbanPage.tsx src/features/sales/SalesKanbanPage.test.tsx
git commit -m "feat(lead-shuffle): admin shuffle control on the sales kanban

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Live smoke test and push

**Files:** none (verification + deploy).

- [ ] **Step 1: Build to confirm the bundle compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 2: Live smoke test as an admin**

Sign in to https://www.itdevcrm.com as `info@itdev.gr` (admin). On `/sales/kanban`:
1. Confirm the **stage dropdown + Shuffle button** appear only for the admin (next to "Create").
2. Pick a stage with a handful of leads (e.g. **No Answer**), note which reps currently own them.
3. Click **Shuffle** → the confirm dialog shows the count and stage → confirm.
4. Verify: the alert reports the number shuffled; the chosen column empties and **New Lead** grows; each moved lead now has a different owner than before and none was returned to its previous owner; the owners are spread roughly evenly.
5. Open one shuffled lead's **Activity** panel and confirm it shows the owner change and the stage change to New Lead, attributed to the admin (not "System").

(If preferred, drive steps 1–4 with Playwright MCP against prod instead of by hand.)

- [ ] **Step 3: Push to main**

Per project convention (push directly to main, no PR):

```bash
git push origin main
```

Expected: Vercel builds and deploys. (Reminder: after deploy, old browser tabs may 404 on stale JS chunks — hard-refresh before re-testing.)

---

## Self-Review

**1. Spec coverage**
- "Button that activates it" → Shuffle button (Task 5). ✓
- "Drop-down list to select the lead status" → `FilterSelect` of shufflable stages (Task 5). ✓
- "Take all leads in that category and distribute to sales again" → hook fetches all leads in the stage and applies the assignment (Tasks 3, 1). ✓
- "Same lead must not be assigned to the rep it had last time" → `planLeadShuffle` no-self guarantee + test (Task 2). ✓
- "Assign to the next salesperson in the list" → satisfied by the clustered round-robin base assignment; the no-self rule is enforced even where strict "next" would collide. ✓
- "All salespeople take the same number of leads" → balanced base + count-preserving swap repair + tests (Task 2). ✓
- "Change the status of the lead to New Lead every time" → `apply_lead_shuffle` sets `stage_id` to `new_lead` (Task 1). ✓
- "For the admins" → `isAdmin` UI gate + `current_user_is_admin()` RPC gate (Tasks 5, 1). ✓
- Stage scope (exclude Constant NA + terminal + converted) → `SHUFFLABLE_CODES` (UI) + `apply_lead_shuffle` allow-list + `converted_at is null` (Tasks 5, 1). ✓
- Pool = existing distribution pool → `lead_shuffle_pool()` wraps `sales_pool_ids()` (Task 1). ✓
- Audit via activity log, no backup table → relies on existing `leads_activity` trigger (verified in Task 6 step 2.5). ✓

**2. Placeholder scan** — no TBD/TODO; every code/test/SQL step is complete and copy-ready. ✓

**3. Type consistency** — `ShuffleLead`/`ShuffleAssignment` defined in Task 2 and consumed in Task 3; `ShuffleStageInput { stageId, stageCode }` defined in Task 3 and passed identically from Task 5 and asserted in the Task 5 test; RPC names `lead_shuffle_pool` / `apply_lead_shuffle` and params `p_stage_code` / `p_assignments` match between Task 1 SQL and Task 3 calls; `SHUFFLABLE_CODES` matches the RPC allow-list exactly. ✓

---

## Changes / Revert

**What this adds**
- 2 Postgres functions: `lead_shuffle_pool()`, `apply_lead_shuffle(text, jsonb)` — additive, no schema/table/trigger changes.
- 5 new frontend files (planner, hook, 2 tests, 1 component test) + edits to `SalesKanbanPage.tsx` and two `sales.json` locale files.
- No data migration, no new table, no change to existing distribution behavior.

**Revert**
- DB: run the ROLLBACK block in `20260623120000_lead_shuffle.sql` (drops both functions) via the Supabase MCP. Removing the functions does not touch any lead data.
- Code: `git revert` the Task 1–5 commits (or revert the merge range). The kanban falls back to its current behavior with no leftover state.
- Data: a shuffle is **not** automatically reversible (per the agreed no-backup decision). Each affected lead's prior owner and stage are recoverable from its `activity_log` entry (`Owner: A → B`, `Stage: X → New Lead`) if a manual undo is ever needed.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-23-sales-kanban-lead-shuffle.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
