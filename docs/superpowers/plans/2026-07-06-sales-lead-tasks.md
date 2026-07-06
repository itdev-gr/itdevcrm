# Sales Lead-Linked Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales users link personal tasks to leads (not clients), see those tasks on the lead page and task board, and get an Assign-to list limited to sales + admins + accounting.

**Architecture:** Add nullable `lead_id` to `user_tasks` (mirrors `client_id`). The task dialog picks lead-mode vs client-mode from the user's group and the task being edited; a new `LeadPicker` mirrors `ClientPicker`. Board cards reuse the existing code-chip/link UI with the lead's code; the lead detail page gets a Tasks tab mirroring the client one.

**Tech Stack:** React 18 + TypeScript (strict), TanStack Query, supabase-js, react-i18next, vitest + testing-library, Supabase Postgres (prod project `xujlrclyzxrvxszepquy`).

**Spec:** `docs/superpowers/specs/2026-07-06-sales-lead-tasks-design.md`

## Global Constraints

- Verify frontend with `npm run build` (strict `tsc -b` + eslint `--max-warnings=0`) — it is stricter than `tsc --noEmit`.
- vitest runs against PROD — run ONLY the specific test files named in each task, never the whole suite.
- No literal secrets anywhere (docs, code, commits). Reference env vars only.
- Commit per task using explicit pathspecs (`git commit -m "..." -- <files>`); another owner session may commit in the same tree.
- Push directly to `main` — no PRs/feature branches.
- Group codes: `sales`, `accounting`, `web_seo`, `local_seo`, `web_dev`, `social_media`, `ai_seo`, `hosting`. Admin is `is_admin`/`isAdmin`, not a group.
- End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: DB migration `user_tasks.lead_id` + prod apply + generated types

**Run in the MAIN session (not a subagent)** — applying to prod may need interactive Supabase MCP auth or an owner-provided token.

**Files:**
- Create: `supabase/migrations/20260706000000_user_tasks_lead_id.sql`
- Modify: `src/types/supabase.ts` (user_tasks block at ~5627–5699)

**Interfaces:**
- Produces: `user_tasks.lead_id uuid null` in prod DB; `Database['public']['Tables']['user_tasks']` Row/Insert/Update contain `lead_id`; later tasks read `task.lead_id` and write `{ lead_id: ... }`.

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================================
-- user_tasks: optional link to a lead (sales work leads, not clients).
-- Mirrors 20260623100000_user_tasks_client_id.sql. A task links to either a
-- client or a lead (UI sets one); on lead delete the task survives unlinked.
-- No RLS change: column inherits user_tasks policies.
--
-- ROLLBACK (manual):
--   drop index if exists public.user_tasks_lead_id;
--   alter table public.user_tasks drop column if exists lead_id;
-- =============================================================================
alter table public.user_tasks
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists user_tasks_lead_id
  on public.user_tasks (lead_id) where lead_id is not null;
```

- [ ] **Step 2: Verify prod schema state first** (parallel-owner-commit rule): confirm the column does NOT already exist before applying:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'user_tasks';
```

Run via Supabase MCP (`execute_sql`) or Management API (`POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, Bearer token from owner, curl UA). Expected: no `lead_id` row.

- [ ] **Step 3: Apply the migration SQL to prod** (same channel). Re-run the Step 2 query; expected: `lead_id` present.

- [ ] **Step 4: Hand-add types.** In `src/types/supabase.ts` user_tasks block: add `lead_id: string | null` to `Row`, `lead_id?: string | null` to `Insert` and `Update` (alphabetical position: after `importance`, before `notes`), and append to `Relationships`:

```ts
{
  foreignKeyName: "user_tasks_lead_id_fkey"
  columns: ["lead_id"]
  isOneToOne: false
  referencedRelation: "leads"
  referencedColumns: ["id"]
},
```

- [ ] **Step 5: Verify types compile**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260706000000_user_tasks_lead_id.sql src/types/supabase.ts
git commit -m "feat(tasks): user_tasks.lead_id column for lead-linked tasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- supabase/migrations/20260706000000_user_tasks_lead_id.sql src/types/supabase.ts
```

---

### Task 2: LeadPicker + useLeadSearch + locale keys

**Files:**
- Create: `src/features/leads/hooks/useLeadSearch.ts`
- Create: `src/features/leads/LeadPicker.tsx`
- Test: `src/features/leads/LeadPicker.test.tsx`
- Modify: `src/lib/queryKeys.ts:16` (add `leadSearch` next to `clientSearch`)
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json` (add `lead_picker` block right after the existing `client_picker` block at ~line 99)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `LeadPicker({ value, onChange, id }: { value: PickedLead | null; onChange: (l: PickedLead | null) => void; id?: string })`; `export type PickedLead = { id: string; name: string }`. Task 4 renders it; Task 6 reuses `PickedLead`.

- [ ] **Step 1: Write the failing test** — mirror of `src/features/clients/ClientPicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const search = vi.fn();
const title = vi.fn();
vi.mock('./hooks/useLeadSearch', () => ({
  useLeadSearch: (term: string) => search(term),
  useLeadTitle: (id: string | null) => title(id),
}));

import { LeadPicker } from './LeadPicker';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('LeadPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockReturnValue({ data: [], isFetching: false });
    title.mockReturnValue({ data: null });
  });

  it('shows the selected lead name and a clear button', () => {
    const onChange = vi.fn();
    render(wrap(<LeadPicker value={{ id: 'l1', name: 'Bakery Lead' }} onChange={onChange} />));
    expect(screen.getByText('Bakery Lead')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('fetches the title when the value has an empty name (edit mode)', () => {
    title.mockReturnValue({ data: 'Fetched Lead' });
    render(wrap(<LeadPicker value={{ id: 'l1', name: '' }} onChange={vi.fn()} />));
    expect(title).toHaveBeenCalledWith('l1');
    expect(screen.getByText('Fetched Lead')).toBeInTheDocument();
  });

  it('selecting a result calls onChange with the lead', async () => {
    const user = userEvent.setup();
    search.mockReturnValue({ data: [{ id: 'l9', title: 'Taverna', code: '001234', company_name: null }], isFetching: false });
    const onChange = vi.fn();
    render(wrap(<LeadPicker value={null} onChange={onChange} />));
    await user.type(screen.getByPlaceholderText(/search lead/i), 'ta');
    expect(await screen.findByRole('option', { name: /Taverna/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Taverna/ }));
    expect(onChange).toHaveBeenCalledWith({ id: 'l9', name: 'Taverna' });
  });

  it('clear resets to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(wrap(<LeadPicker value={{ id: 'l1', name: 'Bakery Lead' }} onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/leads/LeadPicker.test.tsx`
Expected: FAIL (cannot resolve `./LeadPicker` / `./hooks/useLeadSearch`).

- [ ] **Step 3: Add the query key.** In `src/lib/queryKeys.ts`, directly under `clientSearch` (line 16):

```ts
leadSearch: (term: string) => ['lead-search', term] as const,
```

- [ ] **Step 4: Write `src/features/leads/hooks/useLeadSearch.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type LeadSearchRow = {
  id: string;
  title: string;
  code: string | null;
  company_name: string | null;
};

/** Debounced-friendly lead typeahead. Disabled until `term` has >= 2 chars.
 *  Leads RLS scopes results (reps own-only; view_all/admins see all). */
export function useLeadSearch(term: string) {
  const q = term.trim();
  return useQuery<LeadSearchRow[]>({
    queryKey: queryKeys.leadSearch(q.toLowerCase()),
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const like = `%${q}%`;
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, code, company_name')
        .eq('archived', false)
        .or(
          `title.ilike.${like},company_name.ilike.${like},code.ilike.${like},business_profile_name.ilike.${like}`,
        )
        .limit(20)
        .order('title', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadSearchRow[];
    },
  });
}

/** Resolve a lead's display title by id (edit mode only has lead_id). */
export function useLeadTitle(leadId: string | null) {
  return useQuery<string | null>({
    queryKey: ['lead-title', leadId],
    enabled: !!leadId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('title')
        .eq('id', leadId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.title ?? null;
    },
  });
}
```

- [ ] **Step 5: Write `src/features/leads/LeadPicker.tsx`** — structural mirror of `src/features/clients/ClientPicker.tsx` (read it first; same debounce/outside-click/listbox pattern):

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLeadSearch, useLeadTitle } from './hooks/useLeadSearch';

export type PickedLead = { id: string; name: string };

type Props = {
  value: PickedLead | null;
  onChange: (l: PickedLead | null) => void;
  id?: string;
};

export function LeadPicker({ value, onChange, id }: Props) {
  const { t } = useTranslation('common');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(h);
  }, [term]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const { data: results = [], isFetching } = useLeadSearch(debounced);
  // Edit mode passes { id, name: '' } — resolve the title for display.
  const { data: fetchedTitle } = useLeadTitle(value && !value.name ? value.id : null);

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>{t('lead_picker.label')}</Label>
        <div className="flex items-center gap-2">
          <span className="rounded-md border bg-muted px-2 py-1 text-sm">
            {value.name || fetchedTitle || '…'}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            <X className="size-3.5" /> {t('lead_picker.clear')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <Label htmlFor={id}>{t('lead_picker.label')}</Label>
      <div className="relative">
        <Input
          id={id}
          value={term}
          placeholder={t('lead_picker.search_placeholder')}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open && debounced.length >= 2 && (
          <ul role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
            {results.length === 0 && !isFetching ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">{t('lead_picker.no_results')}</li>
            ) : (
              results.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { onChange({ id: l.id, name: l.title }); setOpen(false); setTerm(''); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{l.title}</span>
                    {l.code && <span className="font-mono text-[10px] text-muted-foreground">{l.code}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add locale keys.** In BOTH `src/i18n/locales/en/common.json` and `src/i18n/locales/el/common.json`, insert immediately after the `client_picker` object (~line 99):

en:
```json
"lead_picker": {
  "label": "Lead (optional)",
  "search_placeholder": "Search lead…",
  "no_results": "No leads found",
  "clear": "Clear"
},
```

el:
```json
"lead_picker": {
  "label": "Lead (προαιρετικά)",
  "search_placeholder": "Αναζήτηση lead…",
  "no_results": "Δεν βρέθηκαν leads",
  "clear": "Καθαρισμός"
},
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/features/leads/LeadPicker.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/features/leads/LeadPicker.tsx src/features/leads/LeadPicker.test.tsx src/features/leads/hooks/useLeadSearch.ts src/lib/queryKeys.ts src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(leads): LeadPicker typeahead + lead search hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/leads/LeadPicker.tsx src/features/leads/LeadPicker.test.tsx src/features/leads/hooks/useLeadSearch.ts src/lib/queryKeys.ts src/i18n/locales/en/common.json src/i18n/locales/el/common.json
```

---

### Task 3: taskDialogRules — link-mode + assignee-filter helpers (pure, TDD)

**Files:**
- Create: `src/features/home/taskDialogRules.ts`
- Test: `src/features/home/taskDialogRules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 4 imports both):
  - `taskLinkMode(params: { isSales: boolean; editLeadId: string | null; editClientId: string | null; hasDefaultLead: boolean }): 'lead' | 'client'`
  - `filterTaskAssignees<T extends { is_admin: boolean; group_codes: string[] }>(owners: T[], restrictToSalesCircle: boolean): T[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { taskLinkMode, filterTaskAssignees } from './taskDialogRules';

const base = { isSales: false, editLeadId: null, editClientId: null, hasDefaultLead: false };

describe('taskLinkMode', () => {
  it('defaults to client mode for non-sales users', () => {
    expect(taskLinkMode(base)).toBe('client');
  });
  it('sales users get lead mode when creating', () => {
    expect(taskLinkMode({ ...base, isSales: true })).toBe('lead');
  });
  it('editing a lead-linked task is lead mode regardless of role', () => {
    expect(taskLinkMode({ ...base, editLeadId: 'L1' })).toBe('lead');
  });
  it('editing a client-linked task is client mode even for sales', () => {
    expect(taskLinkMode({ ...base, isSales: true, editClientId: 'C1' })).toBe('client');
  });
  it('a default lead (lead Tasks tab) forces lead mode', () => {
    expect(taskLinkMode({ ...base, hasDefaultLead: true })).toBe('lead');
  });
});

describe('filterTaskAssignees', () => {
  const owners = [
    { user_id: 'a', is_admin: true, group_codes: [] },
    { user_id: 's', is_admin: false, group_codes: ['sales'] },
    { user_id: 'acc', is_admin: false, group_codes: ['accounting'] },
    { user_id: 'tech', is_admin: false, group_codes: ['web_seo'] },
    { user_id: 'multi', is_admin: false, group_codes: ['web_dev', 'sales'] },
  ];
  it('unrestricted returns everyone', () => {
    expect(filterTaskAssignees(owners, false)).toHaveLength(5);
  });
  it('restricted keeps admins, sales and accounting only', () => {
    const ids = filterTaskAssignees(owners, true).map((o) => o.user_id);
    expect(ids).toEqual(['a', 's', 'acc', 'multi']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/home/taskDialogRules.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/features/home/taskDialogRules.ts`**

```ts
export type TaskLinkMode = 'lead' | 'client';

/** Which record picker the task dialog shows. An existing link wins (so any
 *  role can edit any task faithfully); otherwise sales work leads. */
export function taskLinkMode(params: {
  isSales: boolean;
  editLeadId: string | null;
  editClientId: string | null;
  hasDefaultLead: boolean;
}): TaskLinkMode {
  if (params.editLeadId) return 'lead';
  if (params.editClientId) return 'client';
  if (params.hasDefaultLead) return 'lead';
  return params.isSales ? 'lead' : 'client';
}

/** Sales allocate tasks within their circle: sales, admins, accounting. */
export function filterTaskAssignees<T extends { is_admin: boolean; group_codes: string[] }>(
  owners: T[],
  restrictToSalesCircle: boolean,
): T[] {
  if (!restrictToSalesCircle) return owners;
  return owners.filter(
    (o) => o.is_admin || o.group_codes.includes('sales') || o.group_codes.includes('accounting'),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/home/taskDialogRules.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/home/taskDialogRules.ts src/features/home/taskDialogRules.test.ts
git commit -m "feat(tasks): link-mode + assignee-filter rules for the task dialog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/home/taskDialogRules.ts src/features/home/taskDialogRules.test.ts
```

---

### Task 4: Wire TaskDialog (lead mode, assignee filter) + useUpsertTask/useDeleteTask

**Files:**
- Modify: `src/features/home/TaskDialog.tsx`
- Modify: `src/features/home/hooks/useUpsertTask.ts`
- Modify: `src/features/home/hooks/useDeleteTask.ts` (`useDeleteTask` only)
- Test: `src/features/home/TaskDialog.leadmode.test.tsx` (create)

**Interfaces:**
- Consumes: `LeadPicker`/`PickedLead` from Task 2 (`@/features/leads/LeadPicker`); `taskLinkMode`/`filterTaskAssignees` from Task 3 (`./taskDialogRules`); `user_tasks.lead_id` types from Task 1.
- Produces: `TaskDialog` accepts new optional prop `defaultLead?: PickedLead | null` (Task 6 uses it). `useUpsertTask` Input gains `lead_id?: string | null`.

- [ ] **Step 1: Write the failing test** — `src/features/home/TaskDialog.leadmode.test.tsx`. Note: `useAuthStore` is a zustand selector store — mock it as a selector-applying function; mock the mutation hooks so no supabase call happens.

```tsx
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';

type AuthState = { user: { id: string } | null; isAdmin: boolean; groupCodes: string[] };
const authState: AuthState = { user: { id: 'me' }, isAdmin: false, groupCodes: ['sales'] };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: AuthState) => unknown) => sel(authState),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({
    data: [
      { user_id: 'me', full_name: 'Me Sales', email: 'me@x', is_admin: false, group_codes: ['sales'] },
      { user_id: 'adm', full_name: 'Ada Admin', email: 'a@x', is_admin: true, group_codes: [] },
      { user_id: 'acc', full_name: 'Nia Accounting', email: 'n@x', is_admin: false, group_codes: ['accounting'] },
      { user_id: 'tech', full_name: 'Ted Tech', email: 't@x', is_admin: false, group_codes: ['web_seo'] },
    ],
  }),
}));
vi.mock('./hooks/useUpsertTask', () => ({
  useUpsertTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useDeleteTask', () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TaskDialog } from './TaskDialog';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('TaskDialog for sales users', () => {
  it('shows the lead picker instead of the client picker', () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    expect(screen.getByPlaceholderText(/search lead/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search client/i)).not.toBeInTheDocument();
  });

  it('limits Assign-to to sales + admins + accounting', () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    const select = screen.getByLabelText(/assign to/i);
    const names = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(names).toContain('Ada Admin');
    expect(names).toContain('Nia Accounting');
    expect(names).not.toContain('Ted Tech');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/home/TaskDialog.leadmode.test.tsx`
Expected: FAIL — client picker rendered / Ted Tech present.

- [ ] **Step 3: Extend `useUpsertTask`** (`src/features/home/hooks/useUpsertTask.ts`):
  - Add to `Input`: `lead_id?: string | null;` (after `client_id`).
  - Add to `payload`: `...(input.lead_id !== undefined ? { lead_id: input.lead_id } : {}),` (after the `client_id` spread).
  - In `onSuccess`, add: `void qc.invalidateQueries({ queryKey: ['lead-tasks'] });`

- [ ] **Step 4: Extend `useDeleteTask`** (`src/features/home/hooks/useDeleteTask.ts`), `useDeleteTask.onSuccess` becomes:

```ts
onSuccess: () => {
  void qc.invalidateQueries({ queryKey: ['user-tasks'] });
  void qc.invalidateQueries({ queryKey: ['client-tasks'] });
  void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
},
```

- [ ] **Step 5: Wire `TaskDialog.tsx`.** Exact edits:

Imports — add:
```tsx
import { LeadPicker, type PickedLead } from '@/features/leads/LeadPicker';
import { taskLinkMode, filterTaskAssignees } from './taskDialogRules';
```

Props — add `defaultLead`:
```tsx
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this task; otherwise it creates a new one. */
  task?: UserTaskRow | null;
  /** Pre-fill the due-at when creating (e.g. clicked on a specific day in Day view). */
  defaultDueAt?: Date | null;
  /** Pre-select a client when creating (e.g. from a client's Tasks tab). */
  defaultClient?: PickedClient | null;
  /** Pre-select a lead when creating (e.g. from a lead's Tasks tab). */
  defaultLead?: PickedLead | null;
};
```

Component top — pull role state and compute the mode (after the `userId` line):
```tsx
const isAdmin = useAuthStore((s) => s.isAdmin);
const groupCodes = useAuthStore((s) => s.groupCodes);
const isSales = groupCodes.includes('sales') && !isAdmin;
```

State — add lead beside client:
```tsx
const [lead, setLead] = useState<PickedLead | null>(null);
```

Mode (below the state declarations; recomputed per render — cheap and pure):
```tsx
const mode = taskLinkMode({
  isSales,
  editLeadId: task?.lead_id ?? null,
  editClientId: task?.client_id ?? null,
  hasDefaultLead: !!defaultLead,
});
```

Reset effect — set both links (edit branch adds the lead line; create branch mirrors defaultLead; add `defaultLead` to the dependency array):
```tsx
setClient(task.client_id ? { id: task.client_id, name: '' } : null);
setLead(task.lead_id ? { id: task.lead_id, name: '' } : null);
```
…and in the create branch:
```tsx
setClient(defaultClient ?? null);
setLead(defaultLead ?? null);
```

`onSave` payload — replace the `client_id` line with mode-aware links:
```tsx
...(mode === 'lead'
  ? { lead_id: lead?.id ?? null, client_id: null }
  : { client_id: client?.id ?? null, lead_id: null }),
```

Assignees — replace `owners.map(...)` source with the filtered list. After the `useMentionableUsers()` line:
```tsx
const assignees = filterTaskAssignees(owners, isSales);
```
Then in the JSX use `assignees.some(...)` and `assignees.map(...)` in place of the two `owners.` references.

Picker JSX — replace `<ClientPicker value={client} onChange={setClient} id="task-client" />` with:
```tsx
{mode === 'lead' ? (
  <LeadPicker value={lead} onChange={setLead} id="task-lead" />
) : (
  <ClientPicker value={client} onChange={setClient} id="task-client" />
)}
```

- [ ] **Step 6: Run the new test + existing task-dialog consumers**

Run: `npx vitest run src/features/home/TaskDialog.leadmode.test.tsx src/features/tasks/MyTasksPage.newtask.test.tsx src/features/home/taskDialogRules.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/home/TaskDialog.tsx src/features/home/TaskDialog.leadmode.test.tsx src/features/home/hooks/useUpsertTask.ts src/features/home/hooks/useDeleteTask.ts
git commit -m "feat(tasks): sales task dialog links leads + sales-circle assignees

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/home/TaskDialog.tsx src/features/home/TaskDialog.leadmode.test.tsx src/features/home/hooks/useUpsertTask.ts src/features/home/hooks/useDeleteTask.ts
```

---

### Task 5: Board + detail display of the linked lead

**Files:**
- Modify: `src/features/tasks/taskCard.ts`
- Modify: `src/features/tasks/hooks/useTaskBoardData.ts`
- Modify: `src/features/tasks/UserTaskDetailDialog.tsx:33`
- Test: `src/features/tasks/taskCard.test.ts` (extend)
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json` (`tasks_page.lead_label`)

**Interfaces:**
- Consumes: `user_tasks.lead_id` (Task 1). Nothing from Tasks 2–4.
- Produces: `TaskCard` gains `leadName: string | null`; `userTaskToCard` accepts `UserTaskRow & { lead?: TaskLeadJoin | null }` where `export type TaskLeadJoin = { id: string; title: string; code: string | null }` (exported from `taskCard.ts`).

- [ ] **Step 1: Extend the failing test.** In `src/features/tasks/taskCard.test.ts` (read the existing `userRow()` fixture first; extend, don't rewrite), add inside the existing describe/at top level, matching file style:

```ts
it('maps a lead-linked user task to a lead code chip + link', () => {
  const c = userTaskToCard(
    { ...userRow(), lead: { id: 'L1', title: 'Bakery Lead', code: '001234' } },
    me,
  );
  expect(c.sourceCode).toBe('001234');
  expect(c.link).toBe('/leads/L1');
  expect(c.leadName).toBe('Bakery Lead');
});

it('user task without a lead keeps the personal chip (no link)', () => {
  const c = userTaskToCard(userRow(), me);
  expect(c.sourceCode).toBeNull();
  expect(c.link).toBeNull();
  expect(c.leadName).toBeNull();
});
```

(If the file names its `me` constant differently, follow the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/taskCard.test.ts`
Expected: FAIL (`leadName` missing / lead ignored).

- [ ] **Step 3: Implement in `taskCard.ts`.**

Add the join type + `leadName` field:
```ts
export type TaskLeadJoin = { id: string; title: string; code: string | null };
```
In `TaskCard`, after `clientName: string | null;` add:
```ts
leadName: string | null;
```
Change `userTaskToCard` signature and mapping:
```ts
export function userTaskToCard(
  row: UserTaskRow & { lead?: TaskLeadJoin | null },
  meId: string,
): TaskCard {
```
and replace the constant fields:
```ts
sourceCode: row.lead?.code ?? null,
link: row.lead ? `/leads/${row.lead.id}` : null,
notes: row.notes ?? null,
clientName: null,
leadName: row.lead?.title ?? null,
```
In `assignedTaskToCard`, add `leadName: null,` after `clientName`.
Widen `buildBoardCards`'s first param to `Array<UserTaskRow & { lead?: TaskLeadJoin | null }>`.

`leadName` is a REQUIRED field on `TaskCard`, so any test/component that builds a `TaskCard` object literal must add `leadName: null`. Grep for existing literals (`grep -rln "clientName" src --include="*.test.*"` plus `src/features/tasks/TasksKanbanBoard*.test.tsx`, `UserTaskDetailDialog.test.tsx`, `taskBadge.test.ts`) and patch them — strict `npm run build` typechecks tests and will fail otherwise.

- [ ] **Step 4: Fetch the join in `useTaskBoardData.ts`.**

```ts
export type BoardUserTaskRow = UserTaskRow & {
  lead?: { id: string; title: string; code: string | null } | null;
};
```
Change the user-task query generic to `BoardUserTaskRow[]`, the select to:
```ts
let q = supabase.from('user_tasks').select('*, lead:leads(id, title, code)');
```
and the cast to `as unknown as BoardUserTaskRow[]`. Update the hook's return type accordingly (`userRows: BoardUserTaskRow[]`). If the viewer can't see the lead (RLS), the join is null and the card falls back to the "Personal" chip — no code change needed. (Note: `useClientTasks` and `useUserTasks` keep plain `select('*')`; their cards simply have `leadName: null`.)

- [ ] **Step 5: Show the lead in the detail dialog.** In `UserTaskDetailDialog.tsx` after the clientName row (line 33):

```tsx
if (card.leadName) rows.push({ label: c('tasks_page.lead_label'), value: card.leadName });
```

- [ ] **Step 6: Locale keys.** In `tasks_page` of both common.json files, next to `"client_label"`:
- en: `"lead_label": "Lead",`
- el: `"lead_label": "Lead",`

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/features/tasks/taskCard.test.ts src/features/tasks/UserTaskDetailDialog.test.tsx src/features/tasks/TasksKanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts src/features/tasks/hooks/useTaskBoardData.ts src/features/tasks/UserTaskDetailDialog.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(tasks): show linked lead (code chip + detail row) on task board

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts src/features/tasks/hooks/useTaskBoardData.ts src/features/tasks/UserTaskDetailDialog.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
```

---

### Task 6: Lead detail page Tasks tab

**Files:**
- Create: `src/features/leads/hooks/useLeadTasks.ts`
- Create: `src/features/leads/LeadTasksTab.tsx`
- Test: `src/features/leads/LeadTasksTab.test.tsx`
- Modify: `src/features/leads/LeadDetailPage.tsx` (tab trigger ~line 307, content ~line 358)
- Modify: `src/lib/queryKeys.ts:60` (add `leadTasks` next to `clientTasks`)
- Modify: `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json`

**Interfaces:**
- Consumes: `TaskDialog` `defaultLead` prop (Task 4); `TaskCard`/`buildBoardCards` (Task 5); `PickedLead` (Task 2).
- Produces: `LeadTasksTab({ leadId, leadTitle }: { leadId: string; leadTitle: string })`.

- [ ] **Step 1: Write the failing test** — `src/features/leads/LeadTasksTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { TaskCard } from '@/features/tasks/taskCard';

const cards: TaskCard[] = [];
vi.mock('./hooks/useLeadTasks', () => ({
  useLeadTasks: () => ({ cards, isLoading: false }),
}));
vi.mock('@/features/home/TaskDialog', () => ({
  TaskDialog: ({ open }: { open: boolean }) => (open ? <div>task-dialog</div> : null),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

import { LeadTasksTab } from './LeadTasksTab';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('LeadTasksTab', () => {
  it('shows the empty state and opens the new-task dialog', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(wrap(<LeadTasksTab leadId="L1" leadTitle="Bakery" />));
    expect(screen.getByText(/no tasks for this lead/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new task/i }));
    expect(screen.getByText('task-dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/leads/LeadTasksTab.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Add the query key.** In `src/lib/queryKeys.ts`, under `clientTasks` (line 60):

```ts
leadTasks: (leadId: string) => ['lead-tasks', leadId] as const,
```

- [ ] **Step 4: Write `src/features/leads/hooks/useLeadTasks.ts`** (mirror of `useClientTasks`, user_tasks only — assigned_tasks have no lead link):

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { buildBoardCards, type TaskCard } from '@/features/tasks/taskCard';

export function useLeadTasks(leadId: string, meId: string) {
  const query = useQuery<TaskCard[]>({
    queryKey: queryKeys.leadTasks(leadId),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*')
        .eq('lead_id', leadId)
        .order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return buildBoardCards((data ?? []) as UserTaskRow[], [], meId);
    },
  });
  return { cards: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
```

- [ ] **Step 5: Write `src/features/leads/LeadTasksTab.tsx`** (mirror of `src/features/clients/ClientTasksTab.tsx`, `leads` ns, user tasks only):

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { TaskDialog } from '@/features/home/TaskDialog';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { ImportanceBadge } from '@/features/tasks/ImportanceBadge';
import type { TaskCard } from '@/features/tasks/taskCard';
import { useLeadTasks } from './hooks/useLeadTasks';

export function LeadTasksTab({ leadId, leadTitle }: { leadId: string; leadTitle: string }) {
  const { t } = useTranslation('leads');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards, isLoading } = useLeadTasks(leadId, meId);
  const [newOpen, setNewOpen] = useState(false);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);

  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  const open = cards.filter((c) => !c.resolved);
  const resolved = cards.filter((c) => c.resolved);

  const row = (c: TaskCard) => (
    <li key={c.key} className="border-t first:border-t-0">
      <button type="button" onClick={() => setOpenCard(c)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted">
        <span className="truncate text-sm font-medium">{c.title}</span>
        <ImportanceBadge importance={c.importance} />
      </button>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('tasks_tab.open')} ({open.length})
        </h2>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>+ {t('tasks_tab.new')}</Button>
      </div>
      {open.length === 0 ? (
        <p className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">{t('tasks_tab.empty')}</p>
      ) : (
        <ul className="rounded-md border bg-card">{open.map(row)}</ul>
      )}
      {resolved.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('tasks_tab.resolved')} ({resolved.length})
          </h2>
          <ul className="rounded-md border bg-card opacity-70">{resolved.map(row)}</ul>
        </>
      )}

      <TaskDialog open={newOpen} onOpenChange={setNewOpen} defaultLead={{ id: leadId, name: leadTitle }} />
      {openCard?.kind === 'user' && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add the tab to `LeadDetailPage.tsx`.**

Import: `import { LeadTasksTab } from './LeadTasksTab';`

Trigger — after the `attachments` TabsTrigger (line 305–307), insert:
```tsx
<TabsTrigger value="tasks" className={detailTabTriggerClass}>
  {t('tabs.tasks')}
</TabsTrigger>
```

Content — after the `attachments` TabsContent (ends line 358), insert:
```tsx
<TabsContent value="tasks" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
  <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
    <LeadTasksTab leadId={leadId} leadTitle={lead.title} />
  </div>
</TabsContent>
```
(`lead.title` — the lead row is in scope as `lead`; `leadId` param already used by sibling tabs.)

- [ ] **Step 7: Locale keys.**

`src/i18n/locales/en/leads.json`: in `tabs` add `"tasks": "Tasks"`; add top-level:
```json
"tasks_tab": {
  "open": "Open",
  "resolved": "Resolved",
  "empty": "No tasks for this lead yet.",
  "new": "New task"
}
```
`src/i18n/locales/el/leads.json`: in `tabs` add `"tasks": "Εργασίες"`; add top-level:
```json
"tasks_tab": {
  "open": "Ανοιχτές",
  "resolved": "Ολοκληρωμένες",
  "empty": "Δεν υπάρχουν εργασίες για αυτό το lead.",
  "new": "Νέα εργασία"
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/features/leads/LeadTasksTab.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/leads/LeadTasksTab.tsx src/features/leads/LeadTasksTab.test.tsx src/features/leads/hooks/useLeadTasks.ts src/features/leads/LeadDetailPage.tsx src/lib/queryKeys.ts src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): Tasks tab on the lead detail page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/leads/LeadTasksTab.tsx src/features/leads/LeadTasksTab.test.tsx src/features/leads/hooks/useLeadTasks.ts src/features/leads/LeadDetailPage.tsx src/lib/queryKeys.ts src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
```

---

### Task 7: Full verification + push (MAIN session)

**Files:** none (verification only).

- [ ] **Step 1: Strict build**

Run: `npm run build`
Expected: exit 0, zero eslint warnings.

- [ ] **Step 2: Run the feature's test files together**

Run: `npx vitest run src/features/leads/LeadPicker.test.tsx src/features/home/taskDialogRules.test.ts src/features/home/TaskDialog.leadmode.test.tsx src/features/tasks/taskCard.test.ts src/features/leads/LeadTasksTab.test.tsx src/features/tasks/UserTaskDetailDialog.test.tsx src/features/tasks/MyTasksPage.newtask.test.tsx src/features/clients/ClientPicker.test.tsx`
Expected: all PASS.

- [ ] **Step 3: Live smoke as a sales rep** (Playwright or browser; sales creds pw per memory): create a task linked to an own lead from /tasks → verify lead chip on the board card, lead row in detail dialog, task listed on the lead page Tasks tab, Assign-to shows no technical staff. Verify an admin's dialog still shows the client picker.

- [ ] **Step 4: Verify git state then push** (owner may have pushed meanwhile):

```bash
git fetch && git status && git log origin/main..HEAD --oneline
git push origin main
```

- [ ] **Step 5: Update memory** — add a `project_sales_lead_tasks` memory file + MEMORY.md line.
