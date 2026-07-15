# Client tasks surface on deal + job — Phase 1 (read-side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a client's home-page `user_tasks` on the deal and job Tasks tabs in a read-only "From this client" section, so client-scoped tasks stop being invisible there. No schema change.

**Architecture:** New `useClientUserTasks(clientId, meId)` hook fetches `user_tasks` by `client_id` and maps them through the existing `userTaskToCard` into `TaskCard`s. A new `ClientLinkedTasksSection` renders them (reusing `ImportanceBadge` + `UserTaskDetailDialog`). `AssignedTasksTab` gains an optional `clientId` prop and renders the section; `DealDetailPage`/`JobDetailPage` pass the source's client id.

**Tech Stack:** React + TypeScript, @tanstack/react-query, Supabase JS, react-i18next, vitest, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-client-tasks-on-deal-job-design.md`.
- Build gate is strict: `tsc -b && npm run lint && vite build` (eslint `--max-warnings=0`). No unused imports/vars.
- **Do NOT run the full `vitest` suite** — it can hit prod. Run only the specific new test file with `npx vitest run <path>`.
- RLS unchanged: surfaced client tasks respect existing `user_tasks` SELECT RLS (owner/creator/admin).
- i18n keys added to BOTH `en` and `el` (`src/i18n/locales/{en,el}/jobs.json`).
- Reuse existing pieces; do not duplicate `userTaskToCard`, `ImportanceBadge`, or `UserTaskDetailDialog`.

---

### Task 1: `useClientUserTasks` hook + pure mappers

**Files:**
- Create: `src/features/tasks/useClientUserTasks.ts`
- Create: `src/features/tasks/useClientUserTasks.test.ts`
- Modify: `src/lib/queryKeys.ts` (add `clientUserTasks`)

**Interfaces:**
- Consumes: `userTaskToCard(row, meId)` and `TaskCard` from `src/features/tasks/taskCard.ts`; `UserTaskRow` from `src/features/home/hooks/useUserTasks.ts`; `queryKeys` from `src/lib/queryKeys.ts`; `supabase` from `src/lib/supabase.ts`.
- Produces: `mapClientUserTasks(rows: UserTaskRow[], meId: string): TaskCard[]`, `partitionClientTasks(cards: TaskCard[]): { open: TaskCard[]; resolved: TaskCard[] }`, and `useClientUserTasks(clientId: string | undefined, meId: string): { cards: TaskCard[]; isLoading: boolean; error: unknown }`.

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, add after the `clientTasks` line (currently `clientTasks: (clientId: string) => ['client-tasks', clientId] as const,`):

```ts
  clientUserTasks: (clientId: string) => ['client-user-tasks', clientId] as const,
```

- [ ] **Step 2: Write the failing test**

Create `src/features/tasks/useClientUserTasks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapClientUserTasks, partitionClientTasks } from './useClientUserTasks';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';

const base = {
  id: 't1',
  user_id: 'u1',
  title: 'Call client',
  notes: null,
  due_at: '2026-07-20T10:00:00Z',
  completed_at: null,
  created_at: '2026-07-15T09:00:00Z',
  updated_at: '2026-07-15T09:00:00Z',
  created_by: 'u1',
  importance: 'high',
  client_id: 'c1',
  lead_id: null,
  started_at: null,
} as UserTaskRow;

describe('mapClientUserTasks', () => {
  it('maps rows to user TaskCards', () => {
    const [card] = mapClientUserTasks([base], 'u1');
    expect(card.kind).toBe('user');
    expect(card.id).toBe('t1');
    expect(card.title).toBe('Call client');
    expect(card.importance).toBe('high');
    expect(card.resolved).toBe(false);
    expect(card.relation).toBe('mine');
  });

  it('marks completed tasks resolved', () => {
    const [card] = mapClientUserTasks(
      [{ ...base, completed_at: '2026-07-16T00:00:00Z' } as UserTaskRow],
      'u1',
    );
    expect(card.resolved).toBe(true);
  });
});

describe('partitionClientTasks', () => {
  it('splits open and resolved', () => {
    const cards = mapClientUserTasks(
      [base, { ...base, id: 't2', completed_at: '2026-07-16T00:00:00Z' } as UserTaskRow],
      'u1',
    );
    const { open, resolved } = partitionClientTasks(cards);
    expect(open.map((c) => c.id)).toEqual(['t1']);
    expect(resolved.map((c) => c.id)).toEqual(['t2']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/tasks/useClientUserTasks.test.ts`
Expected: FAIL — cannot resolve `./useClientUserTasks` (module not created yet).

- [ ] **Step 4: Create the hook + mappers**

Create `src/features/tasks/useClientUserTasks.ts`:

```ts
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { userTaskToCard, type TaskCard } from './taskCard';

/** Map raw client-linked user_tasks into TaskCards (all kind='user'). Pure. */
export function mapClientUserTasks(rows: UserTaskRow[], meId: string): TaskCard[] {
  return rows.map((r) => userTaskToCard(r, meId));
}

/** Split cards into open (not resolved) and resolved. Pure. */
export function partitionClientTasks(cards: TaskCard[]): {
  open: TaskCard[];
  resolved: TaskCard[];
} {
  return {
    open: cards.filter((c) => !c.resolved),
    resolved: cards.filter((c) => c.resolved),
  };
}

/** A client's personal (user_tasks) tasks, mapped to cards, for surfacing on the
 *  deal/job Tasks tabs. Bounded by user_tasks RLS (owner/creator/admin). */
export function useClientUserTasks(clientId: string | undefined, meId: string) {
  const qc = useQueryClient();
  const query = useQuery<TaskCard[]>({
    queryKey: queryKeys.clientUserTasks(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*')
        .eq('client_id', clientId!)
        .order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return mapClientUserTasks((data ?? []) as UserTaskRow[], meId);
    },
  });

  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`client-user-tasks-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_tasks' },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.clientUserTasks(clientId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, clientId]);

  return { cards: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/useClientUserTasks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/useClientUserTasks.ts src/features/tasks/useClientUserTasks.test.ts src/lib/queryKeys.ts
git commit -m "feat(tasks): useClientUserTasks hook + mappers for client-task surfacing"
```

---

### Task 2: `ClientLinkedTasksSection` component + i18n

**Files:**
- Create: `src/features/tasks/ClientLinkedTasksSection.tsx`
- Modify: `src/i18n/locales/en/jobs.json` (after `assigned_tasks.from_deal`, line 40)
- Modify: `src/i18n/locales/el/jobs.json` (after `assigned_tasks.from_deal`, line 40)

**Interfaces:**
- Consumes: `useClientUserTasks`, `partitionClientTasks` (Task 1); `TaskCard` from `./taskCard`; `ImportanceBadge` from `./ImportanceBadge`; `UserTaskDetailDialog` from `./UserTaskDetailDialog`; `useAuthStore` from `@/lib/stores/authStore`.
- Produces: `ClientLinkedTasksSection({ clientId }: { clientId: string })` — renders nothing when the client has no visible user_tasks.

- [ ] **Step 1: Add i18n keys (en)**

In `src/i18n/locales/en/jobs.json`, inside the `assigned_tasks` object, change the `from_deal` line to add two keys after it:

```json
    "from_deal": "deal",
    "section_client": "From this client",
    "from_client": "client",
```

- [ ] **Step 2: Add i18n keys (el)**

In `src/i18n/locales/el/jobs.json`, inside the `assigned_tasks` object, change the `from_deal` line to add two keys after it:

```json
    "from_deal": "συμφωνία",
    "section_client": "Από τον πελάτη",
    "from_client": "πελάτης",
```

- [ ] **Step 3: Create the component**

Create `src/features/tasks/ClientLinkedTasksSection.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { ImportanceBadge } from './ImportanceBadge';
import { UserTaskDetailDialog } from './UserTaskDetailDialog';
import { useClientUserTasks, partitionClientTasks } from './useClientUserTasks';
import type { TaskCard } from './taskCard';

/** Read-only surfacing of a client's personal (user_tasks) tasks on the deal/job
 *  Tasks tabs. Renders nothing when the client has no visible user tasks. */
export function ClientLinkedTasksSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation('jobs');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards } = useClientUserTasks(clientId, meId);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);
  const { open, resolved } = partitionClientTasks(cards);

  if (cards.length === 0) return null;

  const row = (c: TaskCard) => (
    <li key={c.key} className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setOpenCard(c)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted"
      >
        <span className="truncate text-sm font-medium">{c.title}</span>
        <ImportanceBadge importance={c.importance} />
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {t('assigned_tasks.from_client')}
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t('assigned_tasks.section_client')} ({open.length})
      </h2>
      {open.length > 0 && <ul className="rounded-md border bg-card">{open.map(row)}</ul>}
      {resolved.length > 0 && (
        <ul className="rounded-md border bg-card opacity-70">{resolved.map(row)}</ul>
      )}
      {openCard && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck/build the component in isolation**

Run: `npx tsc -b`
Expected: no errors (component compiles; imports resolve).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ClientLinkedTasksSection.tsx src/i18n/locales/en/jobs.json src/i18n/locales/el/jobs.json
git commit -m "feat(tasks): ClientLinkedTasksSection (from-client tasks) + i18n"
```

---

### Task 3: Wire the section into the deal & job Tasks tabs

**Files:**
- Modify: `src/features/assigned_tasks/AssignedTasksTab.tsx` (Props + render)
- Modify: `src/features/deals/DealDetailPage.tsx:399`
- Modify: `src/features/jobs/JobDetailPage.tsx:629`

**Interfaces:**
- Consumes: `ClientLinkedTasksSection` (Task 2).
- Produces: `AssignedTasksTab` accepts optional `clientId?: string`.

- [ ] **Step 1: Add the prop + import in `AssignedTasksTab.tsx`**

Add the import near the other `@/features/tasks` imports (after the `NEW_TASK_ROW` import line):

```tsx
import { ClientLinkedTasksSection } from '@/features/tasks/ClientLinkedTasksSection';
```

Extend the `Props` type:

```tsx
type Props = {
  source: { kind: 'deal' | 'job'; id: string };
  deptMatch?: { dealId: string; departmentGroupId: string };
  initialOpenTaskId?: string;
  onInitialOpenConsumed?: () => void;
  clientId?: string;
};
```

Update the component signature:

```tsx
export function AssignedTasksTab({ source, deptMatch, initialOpenTaskId, onInitialOpenConsumed, clientId }: Props) {
```

- [ ] **Step 2: Render the section**

In `AssignedTasksTab.tsx`, insert the section immediately before `<NewAssignedTaskDialog ... />` (currently the line `<NewAssignedTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} source={source} />`):

```tsx
      {clientId && <ClientLinkedTasksSection clientId={clientId} />}

      <NewAssignedTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} source={source} />
```

- [ ] **Step 3: Pass `clientId` from the deal page**

In `src/features/deals/DealDetailPage.tsx` line 399, change:

```tsx
            <AssignedTasksTab source={{ kind: 'deal', id: dealId }} />
```
to:
```tsx
            <AssignedTasksTab source={{ kind: 'deal', id: dealId }} clientId={deal.client_id ?? undefined} />
```

- [ ] **Step 4: Pass `clientId` from the job page**

In `src/features/jobs/JobDetailPage.tsx`, add `clientId={job.client_id}` to the `<AssignedTasksTab>` at line 629 (the job's `client_id` is NOT NULL). Result:

```tsx
            <AssignedTasksTab
              source={{ kind: 'job', id: job.id }}
              clientId={job.client_id}
              {...(initialOpenTaskId ? { initialOpenTaskId } : {})}
              onInitialOpenConsumed={handleInitialOpenConsumed}
              {...(groupIdForServiceType(groups, job.service_type)
                ? {
                    deptMatch: {
                      dealId: job.deal_id,
                      departmentGroupId: groupIdForServiceType(groups, job.service_type)!,
                    },
                  }
                : {})}
            />
```

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: green (tsc + eslint max-warnings=0 + vite build all pass).

- [ ] **Step 6: Commit**

```bash
git add src/features/assigned_tasks/AssignedTasksTab.tsx src/features/deals/DealDetailPage.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "feat(tasks): surface client tasks on deal + job Tasks tabs"
```

---

## Live smoke (after Task 3)

On prod, the open client task `0cdea8ff-4148-45bc-9f12-b07a9f17ad21` ("esd NA TON PAREIS…") belongs to client *ΒΑΣΗ ΝΟΜΙΚΩΝ… (Ο ΣΟΛΩΝ)* which has 1 deal + 1 job. Signed in as an admin (or the task's owner):
- Open that client's deal → Tasks tab → a **"From this client"** section shows the task with a "client" chip.
- Open that client's job → Tasks tab → same section shows the task.
- Click the row → `UserTaskDetailDialog` opens (view; Resolve available to owner/admin).
- Confirm the deal/job's own assigned tasks are unaffected. 0 console errors.

## Self-review

- **Spec coverage:** Phase 1 of the spec (read-side surfacing on deal + job, "from client" chip, click → `UserTaskDetailDialog`, no schema change, RLS unchanged) is covered by Tasks 1–3. Phase 2 (deal/job targeting + migration) is a separate plan.
- **Placeholders:** none — all code shown in full.
- **Type consistency:** `mapClientUserTasks`/`partitionClientTasks`/`useClientUserTasks` signatures match between Task 1 (definition), the test, and Task 2 (consumer). `clientId` prop name consistent across AssignedTasksTab, DealDetailPage, JobDetailPage. `queryKeys.clientUserTasks` used in exactly one place (the hook) with the key added in Task 1 Step 1.
