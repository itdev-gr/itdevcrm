# Sales Leads Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/sales/leads` page — an editable spreadsheet-style table of all active leads with search, sortable columns, Status/Assign-to filters, CSV export, bulk edit, and opt-in round-robin distribution of unassigned leads to the Sales team.

**Architecture:** Plain `<table>` mirroring `ClientsListPage`; each row is a `LeadRowEditor` that commits single-field patches via the existing `useUpdateLead` (save-on-blur/change). Search/sort/filter/CSV are pure, client-side helpers over `useLeads()`. Distribution is a Postgres migration: a singleton settings row + a round-robin picker + a `BEFORE INSERT` trigger (gated by an `auto_enabled` toggle, default OFF, only touches unassigned leads) + a manual `distribute_unassigned_leads()` RPC.

**Tech Stack:** React 19 + Vite, TanStack Query, react-i18next, Supabase (Postgres + RLS + RPC), Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-06-16-sales-leads-page-design.md`

**Conventions to follow:**
- Supabase client: `import { supabase } from '@/lib/supabase'`.
- No `any` (eslint `--max-warnings=0`); use `as unknown as <Type>` casts like the existing code (`useLeads.ts:32`).
- Commit after each task. Run `npm run test:run -- <file>` for a single test file.

---

### Task 1: i18n keys for the Leads table

**Files:**
- Modify: `src/i18n/locales/en/leads.json`
- Modify: `src/i18n/locales/el/leads.json`

- [ ] **Step 1: Add a `table`, `distribute`, `bulk`, and `export_csv` block to `en/leads.json`**

Insert these keys at the top level of the JSON object (e.g. after the `"filters"` block):

```json
  "table": {
    "code": "Code",
    "source": "Source",
    "title": "Lead title",
    "full_name": "Full Name",
    "email": "Email",
    "phone": "Phone",
    "website": "Website",
    "category": "Company category",
    "company": "Company name",
    "assign": "Assign to",
    "status": "Status",
    "open": "Open",
    "saving": "Saving…",
    "saved": "Saved",
    "status_all": "All statuses",
    "owner_all": "All owners"
  },
  "distribute": {
    "auto_label": "Auto-distribute new leads",
    "button": "Distribute unassigned ({{count}})",
    "done": "Distributed {{count}} lead(s)"
  },
  "export_csv": "Export CSV",
  "bulk": {
    "selected": "{{count}} selected",
    "reassign": "Reassign to…",
    "set_status": "Set status…",
    "archive": "Archive selected",
    "clear": "Clear"
  },
```

- [ ] **Step 2: Add the same keys to `el/leads.json` (Greek)**

```json
  "table": {
    "code": "Κωδικός",
    "source": "Πηγή",
    "title": "Τίτλος",
    "full_name": "Ονοματεπώνυμο",
    "email": "Email",
    "phone": "Τηλέφωνο",
    "website": "Ιστότοπος",
    "category": "Κατηγορία εταιρείας",
    "company": "Επωνυμία εταιρείας",
    "assign": "Ανάθεση σε",
    "status": "Κατάσταση",
    "open": "Άνοιγμα",
    "saving": "Αποθήκευση…",
    "saved": "Αποθηκεύτηκε",
    "status_all": "Όλες οι καταστάσεις",
    "owner_all": "Όλοι οι υπεύθυνοι"
  },
  "distribute": {
    "auto_label": "Αυτόματη κατανομή νέων leads",
    "button": "Κατανομή μη ανατεθειμένων ({{count}})",
    "done": "Κατανεμήθηκαν {{count}} lead"
  },
  "export_csv": "Εξαγωγή CSV",
  "bulk": {
    "selected": "{{count}} επιλεγμένα",
    "reassign": "Ανάθεση σε…",
    "set_status": "Ορισμός κατάστασης…",
    "archive": "Αρχειοθέτηση επιλεγμένων",
    "clear": "Καθαρισμός"
  },
```

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "require('./src/i18n/locales/en/leads.json'); require('./src/i18n/locales/el/leads.json'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): i18n keys for the Leads table page"
```

---

### Task 2: `filterAndSortLeads` pure helper (TDD)

**Files:**
- Create: `src/features/leads/leadsTableFilter.ts`
- Test: `src/features/leads/leadsTableFilter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { filterAndSortLeads, UNASSIGNED, type LeadLike } from './leadsTableFilter';

const L = (over: Partial<LeadLike>): LeadLike => ({
  id: 'x', code: 'L-0001', source: 'manual', title: 'T', contact_first_name: null,
  contact_last_name: null, email: null, phone: null, website: null, industry: null,
  company_name: null, owner_user_id: null, stage_id: null, ...over,
});

describe('filterAndSortLeads', () => {
  const rows = [
    L({ id: 'a', code: 'L-0003', title: 'Alpha', email: 'a@x.gr', company_name: 'Acme', owner_user_id: 'u1', stage_id: 's1' }),
    L({ id: 'b', code: 'L-0001', title: 'Beta', email: 'b@y.gr', company_name: 'Bolt', owner_user_id: null, stage_id: 's2' }),
    L({ id: 'c', code: 'L-0002', title: 'Gamma', contact_first_name: 'Acme', email: 'c@z.gr', owner_user_id: 'u2', stage_id: 's1' }),
  ];

  it('defaults to sorting by code ascending', () => {
    const out = filterAndSortLeads(rows, {});
    expect(out.map((r) => r.code)).toEqual(['L-0001', 'L-0002', 'L-0003']);
  });

  it('search matches title/name/email/company case-insensitively', () => {
    const out = filterAndSortLeads(rows, { search: 'acme' });
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'c']); // company "Acme" and name "Acme"
  });

  it('filters by statusId and by ownerId', () => {
    expect(filterAndSortLeads(rows, { statusId: 's1' }).map((r) => r.id).sort()).toEqual(['a', 'c']);
    expect(filterAndSortLeads(rows, { ownerId: 'u1' }).map((r) => r.id)).toEqual(['a']);
  });

  it('ownerId UNASSIGNED keeps only leads with no owner', () => {
    expect(filterAndSortLeads(rows, { ownerId: UNASSIGNED }).map((r) => r.id)).toEqual(['b']);
  });

  it('sorts by owner using the provided label resolver, descending', () => {
    const ownerLabel = (id: string | null) => ({ u1: 'Zoe', u2: 'Anna' }[id ?? ''] ?? '');
    const out = filterAndSortLeads(rows.filter((r) => r.owner_user_id), { sort: { key: 'owner', dir: 'desc' }, ownerLabel });
    expect(out.map((r) => r.id)).toEqual(['a', 'c']); // Zoe(a) before Anna(c) when desc
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/leads/leadsTableFilter.test.ts`
Expected: FAIL — cannot resolve `./leadsTableFilter`.

- [ ] **Step 3: Write minimal implementation**

```ts
export const UNASSIGNED = '__unassigned__';

export type LeadLike = {
  id: string;
  code: string | null;
  source: string | null;
  title: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  company_name: string | null;
  owner_user_id: string | null;
  stage_id: string | null;
};

export type LeadSortKey =
  | 'code' | 'source' | 'title' | 'full_name' | 'email' | 'phone'
  | 'website' | 'industry' | 'company_name' | 'owner' | 'status';

export type LeadSort = { key: LeadSortKey; dir: 'asc' | 'desc' };

export type FilterOpts = {
  search?: string;
  statusId?: string | null;
  ownerId?: string | null; // uuid | UNASSIGNED | null
  sort?: LeadSort;
  ownerLabel?: (id: string | null) => string;
  statusLabel?: (stageId: string | null) => string;
};

function fullName(l: LeadLike): string {
  return [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' ');
}

export function filterAndSortLeads<T extends LeadLike>(leads: T[], opts: FilterOpts): T[] {
  const { search = '', statusId = null, ownerId = null, ownerLabel, statusLabel } = opts;
  const sort = opts.sort ?? { key: 'code' as const, dir: 'asc' as const };

  let rows = leads;
  const q = search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((l) =>
      [l.title, fullName(l), l.email, l.company_name].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }
  if (statusId) rows = rows.filter((l) => l.stage_id === statusId);
  if (ownerId === UNASSIGNED) rows = rows.filter((l) => !l.owner_user_id);
  else if (ownerId) rows = rows.filter((l) => l.owner_user_id === ownerId);

  const val = (l: LeadLike): string => {
    switch (sort.key) {
      case 'full_name': return fullName(l);
      case 'owner': return ownerLabel ? ownerLabel(l.owner_user_id) : (l.owner_user_id ?? '');
      case 'status': return statusLabel ? statusLabel(l.stage_id) : (l.stage_id ?? '');
      default: return ((l as unknown as Record<string, unknown>)[sort.key] as string | null) ?? '';
    }
  };

  const sorted = [...rows].sort((a, b) =>
    val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: 'base' }),
  );
  return sort.dir === 'desc' ? sorted.reverse() : sorted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/leads/leadsTableFilter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/leadsTableFilter.ts src/features/leads/leadsTableFilter.test.ts
git commit -m "feat(leads): filterAndSortLeads helper for the Leads table"
```

---

### Task 3: `leadsToCsv` pure helper (TDD)

**Files:**
- Create: `src/features/leads/leadsCsv.ts`
- Test: `src/features/leads/leadsCsv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { leadsToCsv, type CsvColumn } from './leadsCsv';

type Row = { code: string; company: string | null };

describe('leadsToCsv', () => {
  const cols: CsvColumn<Row>[] = [
    { header: 'Code', value: (r) => r.code },
    { header: 'Company', value: (r) => r.company ?? '' },
  ];

  it('writes a header row then one line per row', () => {
    const csv = leadsToCsv([{ code: 'L-1', company: 'Acme' }], cols);
    expect(csv).toBe('Code,Company\nL-1,Acme');
  });

  it('escapes commas, quotes and newlines', () => {
    const csv = leadsToCsv([{ code: 'L-2', company: 'A,"B"\nC' }], cols);
    expect(csv).toBe('Code,Company\nL-2,"A,""B""\nC"');
  });

  it('handles an empty row list (header only)', () => {
    expect(leadsToCsv<Row>([], cols)).toBe('Code,Company');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/leads/leadsCsv.test.ts`
Expected: FAIL — cannot resolve `./leadsCsv`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type CsvColumn<T> = { header: string; value: (row: T) => string };

function esc(s: string): string {
  const v = s ?? '';
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function leadsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => esc(c.header)).join(',');
  if (rows.length === 0) return head;
  const body = rows.map((r) => columns.map((c) => esc(c.value(r) ?? '')).join(',')).join('\n');
  return head + '\n' + body;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/leads/leadsCsv.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/leadsCsv.ts src/features/leads/leadsCsv.test.ts
git commit -m "feat(leads): leadsToCsv export helper"
```

---

### Task 4: Distribution migration + pgTAP guard test

**Files:**
- Create: `supabase/migrations/<new>_lead_distribution.sql` (create with the CLI — never hand-name)
- Create: `supabase/tests/lead_distribution.sql`

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new lead_distribution`
This prints the created path, e.g. `supabase/migrations/20260616XXXXXX_lead_distribution.sql`.

- [ ] **Step 2: Write the migration SQL into that file**

```sql
-- Round-robin distribution of unassigned leads to the Sales team.
-- Default OFF; only ever sets owner_user_id on leads that have none.

create table if not exists public.lead_distribution_state (
  id boolean primary key default true,
  auto_enabled boolean not null default false,
  last_assigned_user_id uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint lead_distribution_state_singleton check (id = true)
);

insert into public.lead_distribution_state (id, auto_enabled)
  values (true, false) on conflict (id) do nothing;

alter table public.lead_distribution_state enable row level security;

create policy lead_distribution_state_read on public.lead_distribution_state
  for select to authenticated using (true);
create policy lead_distribution_state_update on public.lead_distribution_state
  for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- Ordered array of the Sales rotation pool (active, non-archived sales-group members).
create or replace function public.sales_pool_ids()
returns uuid[] language sql security definer set search_path = public stable as $$
  select array_agg(p.user_id order by p.full_name nulls last, p.user_id)
  from public.profiles p
  join public.user_groups ug on ug.user_id = p.user_id
  join public.groups g on g.id = ug.group_id
  where p.is_active = true and p.archived = false and g.code = 'sales';
$$;

-- Next assignee after last_assigned_user_id (wraps; starts at first if none/left pool).
create or replace function public.pick_next_sales_assignee()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pool uuid[];
  last_id uuid;
  idx int;
  next_id uuid;
begin
  pool := public.sales_pool_ids();
  if pool is null or array_length(pool, 1) is null then return null; end if;
  select last_assigned_user_id into last_id from public.lead_distribution_state where id = true;
  idx := array_position(pool, last_id);
  if idx is null then
    next_id := pool[1];
  else
    next_id := pool[(idx % array_length(pool, 1)) + 1];
  end if;
  update public.lead_distribution_state
    set last_assigned_user_id = next_id, updated_at = now() where id = true;
  return next_id;
end $$;

-- BEFORE INSERT: only assigns when toggle is on AND lead has no owner.
create or replace function public.leads_auto_distribute()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  enabled boolean;
  assignee uuid;
begin
  if NEW.owner_user_id is not null then return NEW; end if;
  select auto_enabled into enabled from public.lead_distribution_state where id = true;
  if coalesce(enabled, false) then
    assignee := public.pick_next_sales_assignee();
    if assignee is not null then NEW.owner_user_id := assignee; end if;
  end if;
  return NEW;
end $$;

drop trigger if exists leads_auto_distribute_trg on public.leads;
create trigger leads_auto_distribute_trg
  before insert on public.leads
  for each row execute function public.leads_auto_distribute();

-- Manual: round-robin every active unassigned lead. Admin only. Returns count.
create or replace function public.distribute_unassigned_leads()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  assignee uuid;
  n int := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'permission_denied';
  end if;
  for r in
    select id from public.leads
    where owner_user_id is null and archived = false and converted_at is null
    order by code
  loop
    assignee := public.pick_next_sales_assignee();
    exit when assignee is null;          -- empty pool
    update public.leads set owner_user_id = assignee where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.distribute_unassigned_leads() to authenticated;

-- ROLLBACK:
-- drop trigger if exists leads_auto_distribute_trg on public.leads;
-- drop function if exists public.leads_auto_distribute();
-- drop function if exists public.distribute_unassigned_leads();
-- drop function if exists public.pick_next_sales_assignee();
-- drop function if exists public.sales_pool_ids();
-- drop table if exists public.lead_distribution_state;
```

- [ ] **Step 3: Write the pgTAP guard test**

`supabase/tests/lead_distribution.sql` (runs via `supabase test db`; rolls back):

```sql
begin;
select plan(3);

-- auto-distribute defaults OFF: a new unassigned lead stays unassigned.
do $$
declare sid uuid; lid uuid;
begin
  select id into sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  insert into public.leads (source, title, stage_id) values ('manual', 'pgTAP no-auto', sid) returning id into lid;
  perform set_config('pgtap.lead_id', lid::text, true);
end $$;
select is(
  (select owner_user_id from public.leads where id = current_setting('pgtap.lead_id')::uuid),
  null, 'auto-distribute is OFF by default → lead stays unassigned');

-- the trigger never overwrites a lead inserted WITH an owner (even if enabled).
update public.lead_distribution_state set auto_enabled = true where id = true;
do $$
declare sid uuid; adm uuid; lid uuid;
begin
  select id into sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  select user_id into adm from public.profiles limit 1;  -- any existing user
  insert into public.leads (source, title, stage_id, owner_user_id)
    values ('import', 'pgTAP preassigned', sid, adm) returning id into lid;
  perform set_config('pgtap.lead_id2', lid::text, true);
  perform set_config('pgtap.adm', adm::text, true);
end $$;
select is(
  (select owner_user_id from public.leads where id = current_setting('pgtap.lead_id2')::uuid),
  current_setting('pgtap.adm')::uuid, 'pre-assigned lead keeps its owner when auto is ON');

-- distribute_unassigned_leads with an empty sales pool returns 0 and assigns nothing.
-- (No sales-group members exist in the test transaction.)
select is( public.distribute_unassigned_leads(), 0,
  'distribute returns 0 when the sales pool is empty');

select * from finish();
rollback;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_lead_distribution.sql supabase/tests/lead_distribution.sql
git commit -m "feat(leads): round-robin distribution migration (toggle off by default) + pgTAP guards"
```

> **Note:** This migration is **not** auto-applied (CI doesn't run migrations). It is applied to prod in Task 10's verification step via `supabase db push`. The round-robin happy-path (1,2,3,1,2) is verified live there, since pgTAP can't seed `auth.users`-backed sales members easily.

---

### Task 5: Distribution hooks (`useLeadDistribution`, `useDistributeUnassigned`)

**Files:**
- Create: `src/features/leads/hooks/useLeadDistribution.ts`
- Create: `src/features/leads/hooks/useDistributeUnassigned.ts`

- [ ] **Step 1: Write `useDistributeUnassigned.ts`**

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type RpcResult = { data: number | null; error: { message: string } | null };
const rpc = supabase.rpc as unknown as (fn: string) => Promise<RpcResult>;

export function useDistributeUnassigned() {
  const qc = useQueryClient();
  return useMutation<number, DefaultError, void>({
    mutationFn: captureMutation('leads', 'distribute', async () => {
      const { data, error } = await rpc('distribute_unassigned_leads');
      if (error) throw new Error(error.message);
      return data ?? 0;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
```

- [ ] **Step 2: Write `useLeadDistribution.ts`**

```ts
import { useMutation, useQuery, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const KEY = ['lead-distribution'] as const;

type FromAny = (table: string) => {
  select: (cols: string) => {
    eq: (c: string, v: unknown) => {
      single: () => Promise<{ data: { auto_enabled: boolean } | null; error: { message: string } | null }>;
    };
  };
  update: (patch: Record<string, unknown>) => {
    eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
  };
};
const from = supabase.from as unknown as FromAny;

export function useLeadDistribution() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ auto_enabled: boolean }> => {
      const { data, error } = await from('lead_distribution_state').select('auto_enabled').eq('id', true).single();
      if (error) throw new Error(error.message);
      return { auto_enabled: data?.auto_enabled ?? false };
    },
  });
  const setEnabled = useMutation<void, DefaultError, boolean>({
    mutationFn: async (enabled: boolean) => {
      const { error } = await from('lead_distribution_state')
        .update({ auto_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return { autoEnabled: query.data?.auto_enabled ?? false, isLoading: query.isLoading, setEnabled };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/hooks/useLeadDistribution.ts src/features/leads/hooks/useDistributeUnassigned.ts
git commit -m "feat(leads): hooks for auto-distribute toggle + manual distribute RPC"
```

> After the migration is applied (Task 10) and `npm run types:gen` is run, the `as unknown as` casts here can be simplified, but they are correct and lint-clean as written.

---

### Task 6: `useBulkUpdateLeads` hook

**Files:**
- Create: `src/features/leads/hooks/useBulkUpdateLeads.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export function useBulkUpdateLeads() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { ids: string[]; patch: LeadUpdate }>({
    mutationFn: captureMutation('leads', 'bulk_update', async ({ ids, patch }) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from('leads').update(patch).in('id', ids);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` (expect no errors), then:

```bash
git add src/features/leads/hooks/useBulkUpdateLeads.ts
git commit -m "feat(leads): useBulkUpdateLeads (bulk reassign/status/archive)"
```

---

### Task 7: `LeadRowEditor` component

**Files:**
- Create: `src/features/leads/LeadRowEditor.tsx`

Renders one `<tr>`: a selection checkbox, a read-only Code link, and inline-editable cells. Text/url cells commit on blur; selects commit on change; `title` reverts if cleared. Mirrors the local-state-per-field pattern of `PaymentsPanel`.

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { INDUSTRIES } from '@/lib/industries';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';
import type { AssignableOwner } from './hooks/useAssignableOwners';
import type { StageRow } from '@/features/stages/hooks/usePipelineStages';

const UNASSIGNED = '__unassigned__';
const SOURCES = ['manual', 'meta', 'import'] as const;

type Props = {
  lead: LeadRow;
  owners: AssignableOwner[];
  stages: StageRow[];
  currentUserId: string | null;
  lang: 'en' | 'el';
  selected: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
};

export function LeadRowEditor({ lead, owners, stages, currentUserId, lang, selected, onToggleSelect }: Props) {
  const { t } = useTranslation('leads');
  const update = useUpdateLead();
  const [saved, setSaved] = useState(false);

  const [title, setTitle] = useState(lead.title ?? '');
  const [fullName, setFullName] = useState(
    [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' '),
  );
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [website, setWebsite] = useState(lead.website ?? '');
  const [company, setCompany] = useState(lead.company_name ?? '');

  async function commit(patch: Record<string, unknown>) {
    try {
      await update.mutateAsync({ id: lead.id, patch });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const td = 'border-b px-1 py-1 align-top';

  return (
    <tr>
      <td className={td}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(lead.id, e.target.checked)}
          aria-label="select"
        />
      </td>
      <td className={td}>
        <Link to={`/leads/${lead.id}`} className="font-mono text-xs text-blue-600 underline">
          {lead.code ?? t('table.open')}
        </Link>
      </td>
      <td className={td}>
        <select
          value={lead.source ?? 'manual'}
          onChange={(e) => commit({ source: e.target.value })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`form.source_options.${s}`)}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const v = title.trim();
            if (!v) {
              setTitle(lead.title ?? ''); // required → revert
              return;
            }
            if (v !== (lead.title ?? '')) void commit({ title: v });
          }}
        />
      </td>
      <td className={td}>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onBlur={() => {
            const v = fullName.trim();
            const cur = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
            if (v !== cur) void commit({ contact_first_name: v || null, contact_last_name: null });
          }}
        />
      </td>
      <td className={td}>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => { if (email.trim() !== (lead.email ?? '')) void commit({ email: email.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => { if (phone.trim() !== (lead.phone ?? '')) void commit({ phone: phone.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <Input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onBlur={() => { if (website.trim() !== (lead.website ?? '')) void commit({ website: website.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <select
          value={lead.industry ?? ''}
          onChange={(e) => commit({ industry: e.target.value || null })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          <option value="">—</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind.code} value={ind.code}>{ind.labels[lang]}</option>
          ))}
          {lead.industry && !INDUSTRIES.some((i) => i.code === lead.industry) && (
            <option value={lead.industry}>{lead.industry} (legacy)</option>
          )}
        </select>
      </td>
      <td className={td}>
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onBlur={() => { if (company.trim() !== (lead.company_name ?? '')) void commit({ company_name: company.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <select
          value={lead.owner_user_id ?? UNASSIGNED}
          onChange={(e) => commit({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>
          ))}
        </select>
      </td>
      <td className={td}>
        <select
          value={lead.stage_id ?? ''}
          onChange={(e) => commit({ stage_id: e.target.value })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id} disabled={isStageMoveBlocked(s, currentUserId)}>
              {s.display_names[lang] ?? s.code}
            </option>
          ))}
        </select>
        {saved && <span className="ml-1 text-[10px] text-emerald-600">{t('table.saved')}</span>}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` (expect no errors), then:

```bash
git add src/features/leads/LeadRowEditor.tsx
git commit -m "feat(leads): LeadRowEditor inline-editable row"
```

---

### Task 8: `LeadsListPage` (toolbar + table + bulk + distribute + CSV)

**Files:**
- Create: `src/features/leads/LeadsListPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/stores/authStore';
import { useLeads } from './hooks/useLeads';
import { useAssignableOwners } from './hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useBulkUpdateLeads } from './hooks/useBulkUpdateLeads';
import { useLeadDistribution } from './hooks/useLeadDistribution';
import { useDistributeUnassigned } from './hooks/useDistributeUnassigned';
import { LeadRowEditor } from './LeadRowEditor';
import { filterAndSortLeads, UNASSIGNED, type LeadSort, type LeadSortKey } from './leadsTableFilter';
import { leadsToCsv, type CsvColumn } from './leadsCsv';
import type { LeadRow } from './hooks/useLeads';

const ALL = '__all__';

export function LeadsListPage() {
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const { data: leads = [], isLoading, error } = useLeads({});
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const bulk = useBulkUpdateLeads();
  const distribution = useLeadDistribution();
  const distribute = useDistributeUnassigned();

  const salesStages = useMemo(
    () => stages.filter((s) => s.board === 'sales' && !s.archived).sort((a, b) => a.position - b.position),
    [stages],
  );
  const ownerLabel = useMemo(() => {
    const m = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
    return (id: string | null) => (id ? (m.get(id) ?? '') : '');
  }, [owners]);
  const statusLabel = useMemo(() => {
    const m = new Map(salesStages.map((s) => [s.id, s.display_names[lang] ?? s.code]));
    return (id: string | null) => (id ? (m.get(id) ?? '') : '');
  }, [salesStages, lang]);

  const [search, setSearch] = useState('');
  const [statusId, setStatusId] = useState<string>(ALL);
  const [ownerId, setOwnerId] = useState<string>(ALL);
  const [sort, setSort] = useState<LeadSort>({ key: 'code', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      filterAndSortLeads(leads, {
        search,
        statusId: statusId === ALL ? null : statusId,
        ownerId: ownerId === ALL ? null : ownerId,
        sort,
        ownerLabel,
        statusLabel,
      }),
    [leads, search, statusId, ownerId, sort, ownerLabel, statusLabel],
  );

  const unassignedCount = useMemo(() => leads.filter((l) => !l.owner_user_id).length, [leads]);

  function toggleSort(key: LeadSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  function toggleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function exportCsv() {
    const cols: CsvColumn<LeadRow>[] = [
      { header: t('table.code'), value: (l) => l.code ?? '' },
      { header: t('table.source'), value: (l) => l.source ?? '' },
      { header: t('table.title'), value: (l) => l.title ?? '' },
      { header: t('table.full_name'), value: (l) => [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' ') },
      { header: t('table.email'), value: (l) => l.email ?? '' },
      { header: t('table.phone'), value: (l) => l.phone ?? '' },
      { header: t('table.website'), value: (l) => l.website ?? '' },
      { header: t('table.category'), value: (l) => l.industry ?? '' },
      { header: t('table.company'), value: (l) => l.company_name ?? '' },
      { header: t('table.assign'), value: (l) => ownerLabel(l.owner_user_id) },
      { header: t('table.status'), value: (l) => statusLabel(l.stage_id) },
    ];
    const csv = leadsToCsv(rows, cols);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function bulkApply(patch: Record<string, unknown>) {
    await bulk.mutateAsync({ ids: [...selected], patch });
    setSelected(new Set());
  }

  if (isLoading) return <div className="p-8">…</div>;
  if (error) return <div className="p-8 text-red-600">{error.message}</div>;

  const cols: { key: LeadSortKey; label: string }[] = [
    { key: 'code', label: t('table.code') },
    { key: 'source', label: t('table.source') },
    { key: 'title', label: t('table.title') },
    { key: 'full_name', label: t('table.full_name') },
    { key: 'email', label: t('table.email') },
    { key: 'phone', label: t('table.phone') },
    { key: 'website', label: t('table.website') },
    { key: 'industry', label: t('table.category') },
    { key: 'company_name', label: t('table.company') },
    { key: 'owner', label: t('table.assign') },
    { key: 'status', label: t('table.status') },
  ];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={distribution.autoEnabled}
                disabled={distribution.isLoading || distribution.setEnabled.isPending}
                onChange={(e) => distribution.setEnabled.mutate(e.target.checked)}
              />
              {t('distribute.auto_label')}
            </label>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={unassignedCount === 0 || distribute.isPending}
              onClick={async () => {
                const n = await distribute.mutateAsync();
                alert(t('distribute.done', { count: n }));
              }}
            >
              {t('distribute.button', { count: unassignedCount })}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv}>{t('export_csv')}</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-sm">
          <option value={ALL}>{t('table.status_all')}</option>
          {salesStages.map((s) => (
            <option key={s.id} value={s.id}>{s.display_names[lang] ?? s.code}</option>
          ))}
        </select>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-sm">
          <option value={ALL}>{t('table.owner_all')}</option>
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-slate-50 p-2 text-sm">
          <span>{t('bulk.selected', { count: selected.size })}</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) void bulkApply({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value }); e.currentTarget.value = ''; }}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value="">{t('bulk.reassign')}</option>
            <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
            {owners.map((o) => (<option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>))}
          </select>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) void bulkApply({ stage_id: e.target.value }); e.currentTarget.value = ''; }}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value="">{t('bulk.set_status')}</option>
            {salesStages.map((s) => (<option key={s.id} value={s.id}>{s.display_names[lang] ?? s.code}</option>))}
          </select>
          <Button variant="destructive" size="sm" onClick={() => void bulkApply({ archived: true })}>{t('bulk.archive')}</Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>{t('bulk.clear')}</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-1 py-2">
                  <input
                    type="checkbox"
                    aria-label="select all"
                    checked={selected.size > 0 && selected.size === rows.length}
                    onChange={(e) => selectAll(e.target.checked)}
                  />
                </th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className="cursor-pointer px-1 py-2 hover:underline"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <LeadRowEditor
                  key={lead.id}
                  lead={lead}
                  owners={owners}
                  stages={salesStages}
                  currentUserId={userId}
                  lang={lang}
                  selected={selected.has(lead.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` (expect no errors), then:

```bash
git add src/features/leads/LeadsListPage.tsx
git commit -m "feat(leads): LeadsListPage (table, search/sort/filter, CSV, bulk, distribute)"
```

> If `useAuthStore` selectors differ (verify `s.isAdmin` and `s.user?.id` against `src/lib/stores/authStore.ts` — `LeadDetailPage.tsx:42-43` uses exactly these), match the existing usage.

---

### Task 9: Wire route + sidebar nav

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add the lazy import + route in `router.tsx`**

Add near the other leads lazy import (after `LeadDetailPage`, ~line 67):

```tsx
const LeadsListPage = lazyPage(() => import('@/features/leads/LeadsListPage'), 'LeadsListPage');
```

Add to the `sales` children array (after the `kanban` entry, ~line 183):

```tsx
          { path: 'leads', element: <LeadsListPage /> },
```

- [ ] **Step 2: Add the nav link in `Sidebar.tsx`**

Insert between the "My Clients" and "Sales pipeline" `NavLink`s (~line 95):

```tsx
          <NavLink
            to="/sales/leads"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('leads:title')}
          </NavLink>
```

- [ ] **Step 3: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors/warnings (from these changes).

```bash
git add src/app/router.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(leads): add /sales/leads route + sidebar link"
```

---

### Task 10: Full verification + apply migration to prod

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: typecheck clean, lint clean, all unit tests pass (incl. the new `leadsTableFilter` + `leadsCsv` tests).

- [ ] **Step 2: Apply the distribution migration to prod**

> CI does not run migrations. Apply from a machine with DB access:

Run: `supabase db push`
Then refresh generated types: `npm run types:gen` and commit `src/types/supabase.ts` if it changed:
```bash
git add src/types/supabase.ts && git commit -m "chore(types): regenerate after lead_distribution migration" || true
```

- [ ] **Step 3: Manual E2E in the running app**

Log in as `mkifokeris@itdev.gr`, open `/sales/leads`, and confirm:
- The table lists active leads with all columns; the Code link opens the lead detail page.
- Editing a text cell (e.g. Company name) and blurring persists (reload → value stays); editing Status and Assign-to selects persists; rows don't jump on edit.
- Search narrows rows; clicking a column header sorts (toggles ▲/▼); Status and Assign-to filters narrow rows.
- Tick rows → bulk Reassign and Set status apply to all selected; Archive removes them from the list.
- Export CSV downloads a `leads.csv` matching the visible rows.

- [ ] **Step 4: Verify round-robin distribution live**

- Ensure ≥2 active members exist in the **Sales** group (create test sales users via Admin → Users + add to Sales). Confirm the "Auto-distribute new leads" checkbox is **unchecked**.
- Create 3+ leads with **no owner** (or import). Click **"Distribute unassigned (N)"** → confirm owners are assigned round-robin in `code` order (e.g. with 2 sales + 5 leads: A,B,A,B,A).
- Tick the **Auto-distribute** checkbox; create one more unassigned lead → it gets the next owner automatically. Insert a lead **with** an owner already set → it keeps that owner (not reassigned).
- Untick the checkbox when done.

---

## Self-Review

- **Spec coverage:** columns/inline-edit → Tasks 7–8; search/sort/filters → Tasks 2, 8; CSV → Tasks 3, 8; bulk edit → Tasks 6, 8; distribution (toggle off, manual button, auto trigger, unassigned-only, round-robin) → Tasks 4–5, 8; route/nav → Task 9; i18n → Task 1; testing → Tasks 2, 3, 4, 10. ✅ All spec sections mapped.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `LeadRow` (from `useLeads`) flows into `LeadRowEditor`/`LeadsListPage`; `filterAndSortLeads` accepts `LeadRow` (structurally satisfies `LeadLike`); `LeadSortKey`/`LeadSort` shared between helper and page; `CsvColumn<LeadRow>` matches `leadsToCsv` generic; hook names (`useLeadDistribution`, `useDistributeUnassigned`, `useBulkUpdateLeads`) match their imports.
- **Note:** Distribution hook casts (`as unknown as`) are intentional so the frontend builds before `types:gen`; Task 10 Step 2 regenerates types.
```
