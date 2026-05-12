# Assigned Tasks — Home column + Deal/Job Tasks tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Push directly to `main` (no PRs). Each task ends in a commit.

**Goal:** Let accounting and technical members create work-handoff tasks from inside a deal or a job and assign them to another teammate. The assignee sees the open task in a scrollable column under the calendar on the Home page; clicking **Resolve** removes it from that column. All tasks (open + resolved) stay forever on the originating deal or job under a new **Tasks** tab.

**Architecture:**
- New `public.assigned_tasks` table; exactly one of `deal_id` / `job_id` is set per row. A BEFORE-INSERT trigger denormalises `client_id` + `source_code` from whichever source was given, so list queries can show "company name + deal code" without joins.
- Two notification triggers: assignee gets `task_assigned` when a row is inserted; creator gets `task_resolved` when status flips `open` → `resolved`. Both fan into the existing `public.notifications` table.
- One shared `AssignedTasksTab` component is mounted on the Deal detail page and the Job detail page. A dedicated `AssignedTasksColumn` renders the Home list — open tasks only, filtered to `assignee_user_id = auth.uid()` by default, with the same admin **My / All team** toggle the calendar already uses.
- Permissions: RLS enforces who can `insert` (accounting + any tech group + admin) and who can `update` (assignee, creator, admin). The UI hides the "New task" button for ineligible groups but the DB is the source of truth.

**Tech Stack:** Supabase Postgres (RLS, triggers, Realtime) · React 18 + TS · TanStack Query · Tailwind · shadcn/ui · react-i18next (en + el) · Vitest · Playwright.

---

## File Map

**New files:**
- `supabase/migrations/20260512000001_assigned_tasks.sql` — table, indexes, RLS, denormalise trigger, notification triggers, realtime publication.
- `src/features/assigned_tasks/AssignedTasksColumn.tsx` — Home page scrollable list (open tasks).
- `src/features/assigned_tasks/AssignedTasksTab.tsx` — Deal/Job detail tab content (all statuses, grouped).
- `src/features/assigned_tasks/NewAssignedTaskDialog.tsx` — title + description + assignee picker.
- `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts` — open tasks for Home column.
- `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts` — all-status tasks for a deal or a job.
- `src/features/assigned_tasks/hooks/useCreateAssignedTask.ts` — insert mutation.
- `src/features/assigned_tasks/hooks/useResolveAssignedTask.ts` — resolve mutation.
- `src/features/assigned_tasks/hooks/useAssignedTasksRealtime.ts` — realtime subscription.
- `src/features/assigned_tasks/canCreateAssignedTask.ts` — pure permission helper.
- `src/features/assigned_tasks/hooks/useAssignedTasksOpen.test.tsx`
- `src/features/assigned_tasks/hooks/useCreateAssignedTask.test.tsx`
- `src/features/assigned_tasks/hooks/useResolveAssignedTask.test.tsx`
- `src/features/assigned_tasks/canCreateAssignedTask.test.ts`
- `src/features/assigned_tasks/AssignedTasksColumn.test.tsx`
- `src/features/assigned_tasks/AssignedTasksTab.test.tsx`
- `tests/assigned-tasks-smoke.spec.ts` — Playwright smoke.

**Modified files:**
- `src/app/routes/HomePage.tsx` — stack `<CalendarPage />` over `<AssignedTasksColumn />` in the left column.
- `src/features/deals/DealDetailPage.tsx` — add `Tasks` tab in the `<Tabs>` block.
- `src/features/jobs/JobDetailPage.tsx` — add `Tasks` tab in the `<Tabs>` block.
- `src/features/notifications/NotificationsColumn.tsx` — handle `task_assigned` + `task_resolved` types (route to deal or job).
- `src/lib/queryKeys.ts` — add `assignedTasksOpen`, `assignedTasksForDeal`, `assignedTasksForJob`.
- `src/i18n/locales/en/home.json`, `src/i18n/locales/el/home.json` — `assigned_tasks.*` keys.
- `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json` — `tabs.tasks` key.
- `src/i18n/locales/en/jobs.json`, `src/i18n/locales/el/jobs.json` — `tabs.tasks` key.
- `src/types/supabase.ts` — regenerated.

---

## Task 1: Migration — table, RLS, triggers, realtime

**Files:**
- Create: `supabase/migrations/20260512000001_assigned_tasks.sql`

- [ ] **Step 1: Write the migration**

Create the file with this exact content:

```sql
-- =============================================================================
-- assigned_tasks — work-handoff tasks created from a deal or a job and
-- assigned to another user. Surfaced on the Home page (open only) and on the
-- source deal/job under a "Tasks" tab (all statuses kept forever).
--
-- Rules enforced here:
--   * Exactly one of deal_id / job_id is set per row.
--   * client_id and source_code are denormalised from the source (trigger).
--   * Inserts allowed only for admins, accounting members, or any tech group.
--   * Resolves notify the creator; assignments notify the assignee.
-- =============================================================================

create table public.assigned_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  deal_id uuid references public.deals(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_code text,
  assignee_user_id uuid not null references public.profiles(user_id) on delete restrict,
  created_by_user_id uuid not null references public.profiles(user_id) on delete restrict,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assigned_tasks_one_source
    check ((deal_id is not null) <> (job_id is not null))
);

create index assigned_tasks_assignee_open
  on public.assigned_tasks (assignee_user_id, created_at desc)
  where status = 'open';

create index assigned_tasks_deal
  on public.assigned_tasks (deal_id, created_at desc)
  where deal_id is not null;

create index assigned_tasks_job
  on public.assigned_tasks (job_id, created_at desc)
  where job_id is not null;

create trigger assigned_tasks_set_updated_at
  before update on public.assigned_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Denormalise client_id + source_code from the deal or job referenced.
-- Runs BEFORE INSERT and overrides any client_id/source_code the caller sent,
-- so the row is always consistent with the source.
-- ---------------------------------------------------------------------------
create or replace function public.assigned_tasks_populate_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  c_code text;
begin
  if new.deal_id is not null then
    select client_id, code into c_id, c_code
      from public.deals where id = new.deal_id;
  elsif new.job_id is not null then
    select client_id, code into c_id, c_code
      from public.jobs where id = new.job_id;
  end if;
  if c_id is null then
    raise exception 'assigned_tasks: source deal/job not found';
  end if;
  new.client_id := c_id;
  new.source_code := c_code;
  return new;
end $$;

drop trigger if exists assigned_tasks_populate_source on public.assigned_tasks;
create trigger assigned_tasks_populate_source
  before insert on public.assigned_tasks
  for each row execute function public.assigned_tasks_populate_source();

-- ---------------------------------------------------------------------------
-- Stamp resolved_at / resolved_by automatically when status flips to 'resolved'
-- and unstamp them when it flips back to 'open' (admin reopen path).
-- ---------------------------------------------------------------------------
create or replace function public.assigned_tasks_stamp_resolved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then
    new.resolved_at := now();
    new.resolved_by_user_id := auth.uid();
  elsif new.status = 'open' and (old.status is distinct from 'open') then
    new.resolved_at := null;
    new.resolved_by_user_id := null;
  end if;
  return new;
end $$;

drop trigger if exists assigned_tasks_stamp_resolved on public.assigned_tasks;
create trigger assigned_tasks_stamp_resolved
  before update of status on public.assigned_tasks
  for each row execute function public.assigned_tasks_stamp_resolved();

-- ---------------------------------------------------------------------------
-- Notifications fan-out.
--   on insert → 'task_assigned' for the assignee (suppressed if self-assign)
--   on resolve → 'task_resolved' for the creator (suppressed if creator==resolver)
-- Payload mirrors the existing 'mention' shape so NotificationsColumn can
-- read parent_type/parent_id with the helpers it already has.
-- ---------------------------------------------------------------------------
create or replace function public.assigned_tasks_notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_type text;
  parent_id uuid;
begin
  if new.assignee_user_id = new.created_by_user_id then
    return new;
  end if;
  if new.deal_id is not null then
    parent_type := 'deal'; parent_id := new.deal_id;
  else
    parent_type := 'job';  parent_id := new.job_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.assignee_user_id,
    'task_assigned',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', parent_type,
      'parent_id', parent_id,
      'author_id', new.created_by_user_id,
      'title', new.title,
      'source_code', new.source_code
    )
  );
  return new;
end $$;

drop trigger if exists assigned_tasks_notify_assignee on public.assigned_tasks;
create trigger assigned_tasks_notify_assignee
  after insert on public.assigned_tasks
  for each row execute function public.assigned_tasks_notify_assignee();

create or replace function public.assigned_tasks_notify_creator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_type text;
  parent_id uuid;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  if new.created_by_user_id = coalesce(new.resolved_by_user_id, auth.uid()) then
    return new;
  end if;
  if new.deal_id is not null then
    parent_type := 'deal'; parent_id := new.deal_id;
  else
    parent_type := 'job';  parent_id := new.job_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.created_by_user_id,
    'task_resolved',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', parent_type,
      'parent_id', parent_id,
      'author_id', coalesce(new.resolved_by_user_id, auth.uid()),
      'title', new.title,
      'source_code', new.source_code
    )
  );
  return new;
end $$;

drop trigger if exists assigned_tasks_notify_creator on public.assigned_tasks;
create trigger assigned_tasks_notify_creator
  after update of status on public.assigned_tasks
  for each row execute function public.assigned_tasks_notify_creator();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.assigned_tasks enable row level security;

create policy assigned_tasks_select on public.assigned_tasks
  for select to authenticated
  using (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  );

create policy assigned_tasks_insert on public.assigned_tasks
  for insert to authenticated
  with check (
    auth.uid() = created_by_user_id
    and (
      public.current_user_is_admin()
      or exists (
        select 1
          from public.user_groups ug
          join public.groups g on g.id = ug.group_id
         where ug.user_id = auth.uid()
           and g.code in (
             'accounting',
             'web_seo', 'local_seo', 'web_dev',
             'social_media', 'ai_seo', 'hosting', 'ads'
           )
      )
    )
  );

create policy assigned_tasks_update on public.assigned_tasks
  for update to authenticated
  using (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  )
  with check (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  );

create policy assigned_tasks_delete on public.assigned_tasks
  for delete to authenticated
  using (
    auth.uid() = created_by_user_id
    or public.current_user_is_admin()
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'assigned_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.assigned_tasks';
  end if;
end $$;
```

- [ ] **Step 2: Apply locally**

Run: `npx supabase db reset` (resets the local DB and replays every migration in order).
Expected: completes without error and prints `Finished supabase db reset`. The `assigned_tasks` table appears in `supabase/migrations` history.

If `supabase db reset` is not desired (it wipes local data), run instead: `npx supabase migration up`. Expected output ends with `Local database is up to date`.

- [ ] **Step 3: Regenerate types**

Run: `npx supabase gen types typescript --local > src/types/supabase.ts`
Expected: file rewritten; `grep -n "assigned_tasks" src/types/supabase.ts` returns hits.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260512000001_assigned_tasks.sql src/types/supabase.ts
git commit -m "feat(tasks): assigned_tasks table, RLS, denormalise + notify triggers"
```

---

## Task 2: queryKeys + i18n scaffolding

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/i18n/locales/en/home.json`
- Modify: `src/i18n/locales/el/home.json`
- Modify: `src/i18n/locales/en/deals.json`
- Modify: `src/i18n/locales/el/deals.json`
- Modify: `src/i18n/locales/en/jobs.json`
- Modify: `src/i18n/locales/el/jobs.json`

- [ ] **Step 1: queryKeys additions**

In `src/lib/queryKeys.ts`, inside the `queryKeys` object (alongside the existing entries like `notifications`, `jobsForDeal`), add:

```ts
assignedTasksOpen: (assigneeId: string | null) =>
  ['assigned-tasks', 'open', assigneeId ?? 'all'] as const,
assignedTasksForDeal: (dealId: string) =>
  ['assigned-tasks', 'deal', dealId] as const,
assignedTasksForJob: (jobId: string) =>
  ['assigned-tasks', 'job', jobId] as const,
```

- [ ] **Step 2: i18n — home.json**

Edit `src/i18n/locales/en/home.json` and add a top-level key (sibling of `calendar`):

```json
"assigned_tasks": {
  "title": "Assigned to me",
  "all_team_title": "Assigned tasks",
  "empty": "No open tasks. You're clear.",
  "empty_admin": "No open tasks across the team.",
  "resolve": "Resolve",
  "open_source": "Open"
}
```

Mirror in `src/i18n/locales/el/home.json`:

```json
"assigned_tasks": {
  "title": "Ανατεθειμένα σε εμένα",
  "all_team_title": "Ανατεθειμένες εργασίες",
  "empty": "Καμία ανοιχτή εργασία.",
  "empty_admin": "Καμία ανοιχτή εργασία στην ομάδα.",
  "resolve": "Επίλυση",
  "open_source": "Άνοιγμα"
}
```

- [ ] **Step 3: i18n — deals.json & jobs.json**

In both `src/i18n/locales/en/deals.json` and `src/i18n/locales/en/jobs.json`, add under `tabs`:

```json
"tasks": "Tasks"
```

In both Greek files, add under `tabs`:

```json
"tasks": "Εργασίες"
```

Plus, in both **deals.json** and **jobs.json** for both languages, add a new top-level block:

```json
"assigned_tasks": {
  "section_open": "Open",
  "section_resolved": "Resolved",
  "new_task": "New task",
  "title_placeholder": "Task title",
  "description_placeholder": "Notes, context, what to do…",
  "assignee_label": "Assign to",
  "create": "Create task",
  "resolve": "Resolve",
  "empty": "No tasks yet for this deal.",
  "empty_job": "No tasks yet for this job.",
  "created_by": "by",
  "resolved_by": "resolved by"
}
```

Greek mirror (use translations: "Ανοιχτές" / "Επιλυμένες" / "Νέα εργασία" / "Τίτλος εργασίας" / "Σημειώσεις, πλαίσιο, τι πρέπει να γίνει…" / "Ανάθεση σε" / "Δημιουργία" / "Επίλυση" / "Δεν υπάρχουν ακόμα εργασίες." / "από" / "επιλύθηκε από"). Keep keys identical to English.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queryKeys.ts src/i18n/locales
git commit -m "feat(tasks): queryKeys + en/el strings for assigned tasks"
```

---

## Task 3: Permission helper

**Files:**
- Create: `src/features/assigned_tasks/canCreateAssignedTask.ts`
- Create: `src/features/assigned_tasks/canCreateAssignedTask.test.ts`

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/canCreateAssignedTask.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canCreateAssignedTask } from './canCreateAssignedTask';

describe('canCreateAssignedTask', () => {
  it('allows admins regardless of groups', () => {
    expect(canCreateAssignedTask({ isAdmin: true, groupCodes: [] })).toBe(true);
  });
  it('allows accounting members', () => {
    expect(
      canCreateAssignedTask({ isAdmin: false, groupCodes: ['accounting'] }),
    ).toBe(true);
  });
  it('allows any tech group member', () => {
    for (const g of ['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads']) {
      expect(canCreateAssignedTask({ isAdmin: false, groupCodes: [g] })).toBe(true);
    }
  });
  it('denies sales-only members', () => {
    expect(
      canCreateAssignedTask({ isAdmin: false, groupCodes: ['sales'] }),
    ).toBe(false);
  });
  it('denies users with no groups', () => {
    expect(canCreateAssignedTask({ isAdmin: false, groupCodes: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/canCreateAssignedTask.test.ts`
Expected: FAIL with `Cannot find module './canCreateAssignedTask'`.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/canCreateAssignedTask.ts`:

```ts
const ALLOWED_GROUPS = new Set([
  'accounting',
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
  'ads',
]);

export function canCreateAssignedTask(input: {
  isAdmin: boolean;
  groupCodes: readonly string[];
}): boolean {
  if (input.isAdmin) return true;
  return input.groupCodes.some((c) => ALLOWED_GROUPS.has(c));
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/canCreateAssignedTask.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/canCreateAssignedTask.ts src/features/assigned_tasks/canCreateAssignedTask.test.ts
git commit -m "feat(tasks): canCreateAssignedTask permission helper"
```

---

## Task 4: `useAssignedTasksOpen` hook

**Files:**
- Create: `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`
- Create: `src/features/assigned_tasks/hooks/useAssignedTasksOpen.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/hooks/useAssignedTasksOpen.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useAssignedTasksOpen } from './useAssignedTasksOpen';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTasksOpen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches open tasks for a specific assignee, newest first', async () => {
    order.mockResolvedValue({
      data: [{ id: 't1', title: 'Renew domain', status: 'open' }],
      error: null,
    });
    const { result } = renderHook(
      () => useAssignedTasksOpen({ assigneeUserId: 'u1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('assigned_tasks');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('client:client_id'));
    expect(eq).toHaveBeenCalledWith('assignee_user_id', 'u1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result.current.data?.[0].id).toBe('t1');
  });

  it('skips the assignee filter when assigneeUserId is null (admin all-team)', async () => {
    // When assigneeUserId is null, the hook should not call .eq("assignee_user_id", ...).
    // Instead it should call .order directly on the select chain (status filter only).
    const orderDirect = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqStatus = vi.fn().mockReturnValue({ order: orderDirect });
    const selectAll = vi.fn().mockReturnValue({ eq: eqStatus });
    from.mockReturnValueOnce({ select: selectAll });

    const { result } = renderHook(
      () => useAssignedTasksOpen({ assigneeUserId: null }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqStatus).toHaveBeenCalledWith('status', 'open');
    expect(orderDirect).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/hooks/useAssignedTasksOpen.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type AssignedTaskRow = {
  id: string;
  title: string;
  description: string | null;
  deal_id: string | null;
  job_id: string | null;
  client_id: string;
  source_code: string | null;
  assignee_user_id: string;
  created_by_user_id: string;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  client: { id: string; name: string } | null;
};

const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at,
  client:client_id ( id, name )
`;

export function useAssignedTasksOpen(params: { assigneeUserId: string | null }) {
  const { assigneeUserId } = params;
  return useQuery<AssignedTaskRow[]>({
    queryKey: queryKeys.assignedTasksOpen(assigneeUserId),
    queryFn: async () => {
      let q = supabase
        .from('assigned_tasks')
        .select(SELECT)
        .eq('status', 'open');
      if (assigneeUserId) q = q.eq('assignee_user_id', assigneeUserId);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/hooks/useAssignedTasksOpen.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts src/features/assigned_tasks/hooks/useAssignedTasksOpen.test.tsx
git commit -m "feat(tasks): useAssignedTasksOpen hook for the Home column"
```

---

## Task 5: `useAssignedTasksForSource` hook

**Files:**
- Create: `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts`
- Create: `src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useAssignedTasksForSource } from './useAssignedTasksForSource';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTasksForSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters by deal_id when source is a deal', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'deal', id: 'd1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eq).toHaveBeenCalledWith('deal_id', 'd1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('filters by job_id when source is a job', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'job', id: 'j1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eq).toHaveBeenCalledWith('job_id', 'j1');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { AssignedTaskRow } from './useAssignedTasksOpen';

const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at,
  client:client_id ( id, name )
`;

export function useAssignedTasksForSource(source: { kind: 'deal' | 'job'; id: string }) {
  const column = source.kind === 'deal' ? 'deal_id' : 'job_id';
  const key =
    source.kind === 'deal'
      ? queryKeys.assignedTasksForDeal(source.id)
      : queryKeys.assignedTasksForJob(source.id);

  return useQuery<AssignedTaskRow[]>({
    queryKey: key,
    enabled: !!source.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assigned_tasks')
        .select(SELECT)
        .eq(column, source.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx
git commit -m "feat(tasks): useAssignedTasksForSource hook for deal/job tabs"
```

---

## Task 6: `useCreateAssignedTask` mutation

**Files:**
- Create: `src/features/assigned_tasks/hooks/useCreateAssignedTask.ts`
- Create: `src/features/assigned_tasks/hooks/useCreateAssignedTask.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/hooks/useCreateAssignedTask.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, select, insert, from } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { single, select, insert, from };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me' } } }) },
  },
}));

import { useCreateAssignedTask } from './useCreateAssignedTask';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useCreateAssignedTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a deal-scoped task with the current user as creator', async () => {
    single.mockResolvedValue({ data: { id: 't1' }, error: null });
    const { result } = renderHook(() => useCreateAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({
      source: { kind: 'deal', id: 'd1' },
      title: 'Renew domain',
      description: 'before May 30',
      assigneeUserId: 'u2',
    });
    expect(id).toBe('t1');
    expect(insert).toHaveBeenCalledWith({
      title: 'Renew domain',
      description: 'before May 30',
      deal_id: 'd1',
      job_id: null,
      assignee_user_id: 'u2',
      created_by_user_id: 'me',
    });
  });

  it('inserts a job-scoped task and sets deal_id null', async () => {
    single.mockResolvedValue({ data: { id: 't2' }, error: null });
    const { result } = renderHook(() => useCreateAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({
      source: { kind: 'job', id: 'j1' },
      title: 'Hotfix',
      description: null,
      assigneeUserId: 'u3',
    });
    expect(insert).toHaveBeenCalledWith({
      title: 'Hotfix',
      description: null,
      deal_id: null,
      job_id: 'j1',
      assignee_user_id: 'u3',
      created_by_user_id: 'me',
    });
  });

  it('throws on insert error', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    const { result } = renderHook(() => useCreateAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      result.current.mutateAsync({
        source: { kind: 'deal', id: 'd1' },
        title: 'x',
        description: null,
        assigneeUserId: 'u2',
      }),
    ).rejects.toThrow('rls denied');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/hooks/useCreateAssignedTask.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/hooks/useCreateAssignedTask.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CreateAssignedTaskInput = {
  source: { kind: 'deal' | 'job'; id: string };
  title: string;
  description: string | null;
  assigneeUserId: string;
};

export function useCreateAssignedTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAssignedTaskInput): Promise<string> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('assigned_tasks')
        .insert({
          title: input.title,
          description: input.description,
          deal_id: input.source.kind === 'deal' ? input.source.id : null,
          job_id: input.source.kind === 'job' ? input.source.id : null,
          assignee_user_id: input.assigneeUserId,
          created_by_user_id: user.id,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: (_id, input) => {
      qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      if (input.source.kind === 'deal') {
        qc.invalidateQueries({ queryKey: queryKeys.assignedTasksForDeal(input.source.id) });
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.assignedTasksForJob(input.source.id) });
      }
    },
  });
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/hooks/useCreateAssignedTask.test.tsx`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/hooks/useCreateAssignedTask.ts src/features/assigned_tasks/hooks/useCreateAssignedTask.test.tsx
git commit -m "feat(tasks): useCreateAssignedTask mutation"
```

---

## Task 7: `useResolveAssignedTask` mutation

**Files:**
- Create: `src/features/assigned_tasks/hooks/useResolveAssignedTask.ts`
- Create: `src/features/assigned_tasks/hooks/useResolveAssignedTask.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/hooks/useResolveAssignedTask.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useResolveAssignedTask } from './useResolveAssignedTask';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useResolveAssignedTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the row to status=resolved', async () => {
    eq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useResolveAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ id: 't1' });
    expect(update).toHaveBeenCalledWith({ status: 'resolved' });
    expect(eq).toHaveBeenCalledWith('id', 't1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('throws on error', async () => {
    eq.mockResolvedValue({ error: { message: 'denied' } });
    const { result } = renderHook(() => useResolveAssignedTask(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync({ id: 't1' })).rejects.toThrow('denied');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/hooks/useResolveAssignedTask.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/hooks/useResolveAssignedTask.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useResolveAssignedTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const { error } = await supabase
        .from('assigned_tasks')
        .update({ status: 'resolved' })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
      return input.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
    },
  });
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/hooks/useResolveAssignedTask.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/hooks/useResolveAssignedTask.ts src/features/assigned_tasks/hooks/useResolveAssignedTask.test.tsx
git commit -m "feat(tasks): useResolveAssignedTask mutation"
```

---

## Task 8: Realtime subscription hook

**Files:**
- Create: `src/features/assigned_tasks/hooks/useAssignedTasksRealtime.ts`

No tests — this is a thin wrapper over `supabase.channel`, identical in shape to `src/features/notifications/hooks/useNotificationsRealtime.ts`. (Read that file first to mirror its structure: useEffect that subscribes on mount, invalidates the relevant query keys on `INSERT` / `UPDATE` / `DELETE`, unsubscribes on unmount.)

- [ ] **Step 1: Read the reference**

Run: `cat src/features/notifications/hooks/useNotificationsRealtime.ts`
Expected: a short file using `supabase.channel(...).on('postgres_changes', ...).subscribe()`.

- [ ] **Step 2: Implement**

Create `src/features/assigned_tasks/hooks/useAssignedTasksRealtime.ts`:

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useAssignedTasksRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('assigned_tasks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assigned_tasks' },
        () => {
          qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: passes (or fails on existing pre-existing errors — but no new errors in this file).

- [ ] **Step 4: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTasksRealtime.ts
git commit -m "feat(tasks): realtime invalidation for assigned_tasks"
```

---

## Task 9: `NewAssignedTaskDialog` component

**Files:**
- Create: `src/features/assigned_tasks/NewAssignedTaskDialog.tsx`

This is a controlled dialog using the existing shadcn `<Dialog>` (look at `src/features/home/TaskDialog.tsx` for the exact import + layout pattern). It needs: title input, description textarea, assignee `<select>` populated from `useAssignableOwners()`, Create button, Cancel button. Submits via `useCreateAssignedTask`. Closes on success.

- [ ] **Step 1: Read the reference dialog**

Run: `cat src/features/home/TaskDialog.tsx`
Note its imports (`@/components/ui/dialog`, `Button`, etc.) and the way it handles `open` / `onOpenChange`, form state, and submit. Copy the same structure.

- [ ] **Step 2: Implement**

Create `src/features/assigned_tasks/NewAssignedTaskDialog.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { useCreateAssignedTask } from './hooks/useCreateAssignedTask';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: { kind: 'deal' | 'job'; id: string };
};

export function NewAssignedTaskDialog({ open, onOpenChange, source }: Props) {
  // jobs and deals share the same i18n block (assigned_tasks.*); namespace
  // doesn't matter here as long as the keys exist in both. Use 'jobs'.
  const { t } = useTranslation('jobs');
  const create = useCreateAssignedTask();
  const { data: owners = [] } = useAssignableOwners();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assigneeUserId) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({
        source,
        title: title.trim(),
        description: description.trim() || null,
        assigneeUserId,
      });
      setTitle('');
      setDescription('');
      setAssigneeUserId('');
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assigned_tasks.new_task')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="at-title">{t('assigned_tasks.title_placeholder')}</Label>
            <Input
              id="at-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-desc">{t('assigned_tasks.description_placeholder')}</Label>
            <textarea
              id="at-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="at-assignee">{t('assigned_tasks.assignee_label')}</Label>
            <select
              id="at-assignee"
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              required
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="" disabled>—</option>
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.full_name || o.email}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !title.trim() || !assigneeUserId}
            >
              {t('assigned_tasks.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint src/features/assigned_tasks/NewAssignedTaskDialog.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/assigned_tasks/NewAssignedTaskDialog.tsx
git commit -m "feat(tasks): NewAssignedTaskDialog (title + description + assignee)"
```

---

## Task 10: `AssignedTasksTab` shared component

**Files:**
- Create: `src/features/assigned_tasks/AssignedTasksTab.tsx`
- Create: `src/features/assigned_tasks/AssignedTasksTab.test.tsx`

Renders all tasks for a given deal or job, split into **Open** and **Resolved** sections, with a **New task** button that opens `NewAssignedTaskDialog`. The button is hidden when `canCreateAssignedTask` returns false.

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/AssignedTasksTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import i18n from '@/i18n/index';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; groupCodes: string[] }) => unknown) =>
    sel({ isAdmin: false, groupCodes: ['accounting'] }),
}));

vi.mock('./hooks/useAssignedTasksForSource', () => ({
  useAssignedTasksForSource: () => ({
    data: [
      {
        id: 't1', title: 'Renew domain', description: null,
        deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
        assignee_user_id: 'u2', created_by_user_id: 'u1',
        status: 'open', resolved_at: null, resolved_by_user_id: null,
        created_at: new Date().toISOString(),
        client: { id: 'c1', name: 'Acme Ltd' },
      },
      {
        id: 't2', title: 'Old work', description: null,
        deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
        assignee_user_id: 'u2', created_by_user_id: 'u1',
        status: 'resolved', resolved_at: new Date().toISOString(), resolved_by_user_id: 'u2',
        created_at: new Date().toISOString(),
        client: { id: 'c1', name: 'Acme Ltd' },
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

import { AssignedTasksTab } from './AssignedTasksTab';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('AssignedTasksTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders open and resolved sections with their tasks', () => {
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(screen.getByText('Old work')).toBeInTheDocument();
    expect(screen.getByText(/open/i)).toBeInTheDocument();
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });

  it('shows the New task button when the user can create', () => {
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/AssignedTasksTab.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/AssignedTasksTab.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { relativeFromNow } from '@/lib/datetime';
import { useAssignedTasksForSource } from './hooks/useAssignedTasksForSource';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';
import { NewAssignedTaskDialog } from './NewAssignedTaskDialog';
import { canCreateAssignedTask } from './canCreateAssignedTask';
import type { AssignedTaskRow } from './hooks/useAssignedTasksOpen';

type Props = { source: { kind: 'deal' | 'job'; id: string } };

function TaskRow({ task }: { task: AssignedTaskRow }) {
  const { t } = useTranslation('jobs');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const resolve = useResolveAssignedTask();
  const isAssignee = task.assignee_user_id === userId;
  const canResolve = task.status === 'open' && (isAssignee || isAdmin);

  return (
    <li className="flex items-start gap-3 border-t px-3 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{task.title}</span>
          {task.source_code && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              {task.source_code}
            </span>
          )}
          {task.client && (
            <span className="text-[11px] text-slate-500">· {task.client.name}</span>
          )}
        </div>
        {task.description && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{task.description}</p>
        )}
        <p className="mt-1 text-[10px] text-slate-400">
          {relativeFromNow(task.created_at)}
          {task.resolved_at && ` · ${t('assigned_tasks.resolved_by')} ${relativeFromNow(task.resolved_at)}`}
        </p>
      </div>
      {canResolve && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => resolve.mutate({ id: task.id })}
          disabled={resolve.isPending}
        >
          {t('assigned_tasks.resolve')}
        </Button>
      )}
    </li>
  );
}

export function AssignedTasksTab({ source }: Props) {
  const { t } = useTranslation('jobs');
  useAssignedTasksRealtime();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canCreate = canCreateAssignedTask({ isAdmin, groupCodes });
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: tasks = [], isLoading, error } = useAssignedTasksForSource(source);

  if (isLoading) return <div className="text-sm text-slate-500">…</div>;
  if (error) return <div className="text-sm text-red-600">{(error as Error).message}</div>;

  const open = tasks.filter((x) => x.status === 'open');
  const resolved = tasks.filter((x) => x.status === 'resolved');
  const emptyKey = source.kind === 'deal' ? 'assigned_tasks.empty' : 'assigned_tasks.empty_job';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {t('assigned_tasks.section_open')} ({open.length})
        </h2>
        {canCreate && (
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            + {t('assigned_tasks.new_task')}
          </Button>
        )}
      </div>
      {open.length === 0 ? (
        <p className="rounded-md border bg-slate-50 p-4 text-sm text-slate-500">{t(emptyKey)}</p>
      ) : (
        <ul className="rounded-md border bg-white">
          {open.map((task) => <TaskRow key={task.id} task={task} />)}
        </ul>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
        {t('assigned_tasks.section_resolved')} ({resolved.length})
      </h2>
      {resolved.length > 0 && (
        <ul className="rounded-md border bg-white opacity-70">
          {resolved.map((task) => <TaskRow key={task.id} task={task} />)}
        </ul>
      )}

      <NewAssignedTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} source={source} />
    </div>
  );
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/AssignedTasksTab.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/AssignedTasksTab.tsx src/features/assigned_tasks/AssignedTasksTab.test.tsx
git commit -m "feat(tasks): AssignedTasksTab with open/resolved sections"
```

---

## Task 11: Mount Tasks tab on DealDetailPage + JobDetailPage

**Files:**
- Modify: `src/features/deals/DealDetailPage.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx`

- [ ] **Step 1: Edit DealDetailPage**

In `src/features/deals/DealDetailPage.tsx`:

1. Add this import near the other tab-content imports (after the `JobsTab` import on line 21):

```ts
import { AssignedTasksTab } from '@/features/assigned_tasks/AssignedTasksTab';
```

2. Add a new `<TabsTrigger>` inside the `<TabsList>` (after `<TabsTrigger value="jobs">`):

```tsx
<TabsTrigger value="tasks">{t('tabs.tasks')}</TabsTrigger>
```

3. Add a new `<TabsContent>` immediately after the `<TabsContent value="jobs">` block:

```tsx
<TabsContent value="tasks" className="pt-4">
  <AssignedTasksTab source={{ kind: 'deal', id: dealId }} />
</TabsContent>
```

- [ ] **Step 2: Edit JobDetailPage**

In `src/features/jobs/JobDetailPage.tsx`:

1. Add this import next to `MonthlyTasksPanel`:

```ts
import { AssignedTasksTab } from '@/features/assigned_tasks/AssignedTasksTab';
```

2. Add a new `<TabsTrigger>` inside the `<TabsList>` (after `<TabsTrigger value="overview">`):

```tsx
<TabsTrigger value="tasks">Tasks</TabsTrigger>
```

(Job tabs in this file are hardcoded English — match the existing style. Translation strings live in `jobs.json` for screens that use them.)

3. Add a `<TabsContent>` after `<TabsContent value="overview">`:

```tsx
<TabsContent value="tasks" className="pt-4">
  <AssignedTasksTab source={{ kind: 'job', id: job.id }} />
</TabsContent>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke run**

Run: `npm run dev`, open `http://localhost:5173`, navigate to any existing deal and any existing job, click the new **Tasks** tab. Confirm:
- Tab loads with "Open (0)" header and the empty-state placeholder.
- If the signed-in user is in accounting / a tech group / admin, the **+ New task** button is visible. Otherwise it is hidden.
- Stop the dev server (Ctrl-C) when done.

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/DealDetailPage.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "feat(tasks): Tasks tab on deal and job detail pages"
```

---

## Task 12: `AssignedTasksColumn` (Home)

**Files:**
- Create: `src/features/assigned_tasks/AssignedTasksColumn.tsx`
- Create: `src/features/assigned_tasks/AssignedTasksColumn.test.tsx`

Renders open tasks only. Defaults to current user; admins get a "My / All team" toggle (mirrors the calendar's existing toggle). Each row shows title + source code + company + assignee (when in all-team mode) + a Resolve button (visible only to the assignee or admin). Scrollable.

- [ ] **Step 1: Failing test**

Create `src/features/assigned_tasks/AssignedTasksColumn.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import i18n from '@/i18n/index';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } | null; groupCodes: string[] }) => unknown) =>
    sel({ isAdmin: false, user: { id: 'u-me' }, groupCodes: ['accounting'] }),
}));

vi.mock('./hooks/useAssignedTasksRealtime', () => ({
  useAssignedTasksRealtime: () => undefined,
}));

vi.mock('./hooks/useAssignedTasksOpen', () => ({
  useAssignedTasksOpen: ({ assigneeUserId }: { assigneeUserId: string | null }) => ({
    data:
      assigneeUserId === 'u-me'
        ? [
            {
              id: 't1', title: 'Renew domain', description: 'before May 30',
              deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
              assignee_user_id: 'u-me', created_by_user_id: 'u-other',
              status: 'open', resolved_at: null, resolved_by_user_id: null,
              created_at: new Date().toISOString(),
              client: { id: 'c1', name: 'Acme Ltd' },
            },
          ]
        : [],
    isLoading: false,
  }),
}));

import { AssignedTasksColumn } from './AssignedTasksColumn';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('AssignedTasksColumn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the open tasks for the current user', () => {
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByText(/000013/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
  });

  it('links the source code to the originating deal', () => {
    render(wrap(<AssignedTasksColumn />));
    const link = screen.getByRole('link', { name: /000013/i });
    expect(link).toHaveAttribute('href', '/deals/d1');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/features/assigned_tasks/AssignedTasksColumn.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/features/assigned_tasks/AssignedTasksColumn.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAssignedTasksOpen, type AssignedTaskRow } from './hooks/useAssignedTasksOpen';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';

function sourceHref(task: AssignedTaskRow): string {
  if (task.deal_id) return `/deals/${task.deal_id}`;
  if (task.job_id) return `/jobs/${task.job_id}`;
  return '#';
}

function Row({ task, canResolve }: { task: AssignedTaskRow; canResolve: boolean }) {
  const { t } = useTranslation('home');
  const resolve = useResolveAssignedTask();
  return (
    <li className="flex items-start gap-3 border-t px-3 py-2.5 first:border-t-0 hover:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{task.title}</span>
          <Link
            to={sourceHref(task)}
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200"
          >
            {task.source_code ?? '—'}
          </Link>
        </div>
        {task.client && (
          <p className="truncate text-[11px] text-slate-500">{task.client.name}</p>
        )}
        {task.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{task.description}</p>
        )}
      </div>
      {canResolve && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => resolve.mutate({ id: task.id })}
          disabled={resolve.isPending}
        >
          {t('assigned_tasks.resolve')}
        </Button>
      )}
    </li>
  );
}

export function AssignedTasksColumn() {
  const { t } = useTranslation('home');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const [showAllAdmin, setShowAllAdmin] = useState(false);
  useAssignedTasksRealtime();

  const assigneeUserId = isAdmin && showAllAdmin ? null : userId || null;
  const { data: tasks = [] } = useAssignedTasksOpen({ assigneeUserId });

  const title = showAllAdmin ? t('assigned_tasks.all_team_title') : t('assigned_tasks.title');
  const empty = showAllAdmin ? t('assigned_tasks.empty_admin') : t('assigned_tasks.empty');

  return (
    <section className="flex h-80 min-h-0 flex-col border-t bg-white">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-2.5">
        <h2 className="text-sm font-semibold">{title} ({tasks.length})</h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAllAdmin((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              showAllAdmin
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-300 bg-slate-100 text-slate-700'
            }`}
          >
            {showAllAdmin ? t('all_team_title') : t('title')}
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">{empty}</p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <Row
                key={task.id}
                task={task}
                canResolve={isAdmin || task.assignee_user_id === userId}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `npx vitest run src/features/assigned_tasks/AssignedTasksColumn.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/AssignedTasksColumn.tsx src/features/assigned_tasks/AssignedTasksColumn.test.tsx
git commit -m "feat(tasks): AssignedTasksColumn for the Home page"
```

---

## Task 13: HomePage layout — stack column under calendar

**Files:**
- Modify: `src/app/routes/HomePage.tsx`

The current layout is `[CalendarPage flex-1] [NotificationsColumn w-80]`. New layout: left side is now a vertical stack `[CalendarPage flex-1] [AssignedTasksColumn h-80]`; the notifications column on the right stays as-is.

- [ ] **Step 1: Edit HomePage.tsx**

Replace the entire content of `src/app/routes/HomePage.tsx` with:

```tsx
import { CalendarPage } from '@/features/home/CalendarPage';
import { NotificationsColumn } from '@/features/notifications/NotificationsColumn';
import { AssignedTasksColumn } from '@/features/assigned_tasks/AssignedTasksColumn';

export function HomePage() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <CalendarPage />
        </div>
        <AssignedTasksColumn />
      </div>
      <NotificationsColumn />
    </div>
  );
}
```

- [ ] **Step 2: Smoke run**

Run: `npm run dev` then open the Home page (`/`). Confirm:
- The calendar fills the upper area as before.
- A bordered panel **Assigned to me (N)** sits beneath it, ~320px tall, with its own scrollbar when the list is long.
- The right Notifications column is unchanged.
- Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/app/routes/HomePage.tsx
git commit -m "feat(tasks): mount AssignedTasksColumn under the home calendar"
```

---

## Task 14: Notifications routing for `task_assigned` / `task_resolved`

**Files:**
- Modify: `src/features/notifications/NotificationsColumn.tsx`

The existing `readPath` helper only handles `lead`, `client`, `deal`. The new notification types carry `parent_type: 'deal' | 'job'`, so add `job` and make sure the row content shows the task title from `payload.title`.

- [ ] **Step 1: Read the current file**

Run: `cat src/features/notifications/NotificationsColumn.tsx | head -120`
Find the `readPath` switch (around line 13) and the render block that displays each notification.

- [ ] **Step 2: Extend `readPath`**

Add a `job` case so:

```ts
switch (parentType) {
  case 'lead':   return `/leads/${parentId}`;
  case 'client': return `/clients/${parentId}`;
  case 'deal':   return `/deals/${parentId}`;
  case 'job':    return `/jobs/${parentId}`;
  default:       return null;
}
```

- [ ] **Step 3: Render task notifications with their title**

The existing render block likely branches on `n.type`. Add (or extend) branches to recognise `task_assigned` and `task_resolved`. Use `readString(n.payload, 'title')` for the body and `readString(n.payload, 'source_code')` for the small monospace badge. If the existing component uses a generic renderer, no per-type branch is needed — verify the title surfaces by inspecting one row after Task 1's migration has run.

After editing, the row for a `task_assigned` notification should:
- Show the task title (`payload.title`) as the primary text.
- Show the source code (e.g. "000013") as a small monospace badge.
- Link to `readPath(payload.parent_type, payload.parent_id)`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/NotificationsColumn.tsx
git commit -m "feat(tasks): route task notifications to deal/job"
```

---

## Task 15: Playwright smoke

**Files:**
- Create: `tests/assigned-tasks-smoke.spec.ts`

Verifies the full happy path against the dev server (assumes `npm run dev` and seeded test users; mirror the existing patterns in `tests/smoke.spec.ts` and `tests/leads-smoke.spec.ts` for login + fixtures).

- [ ] **Step 1: Read the reference**

Run: `cat tests/leads-smoke.spec.ts`
Note its login flow + selectors. Mirror them.

- [ ] **Step 2: Write the spec**

Create `tests/assigned-tasks-smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Reuses an existing seeded deal with code 000013 (from
// supabase/migrations/20260503000015_recurring_payments_test_2min.sql).
const DEAL_CODE = '000013';

test('accounting user creates a task; assignee resolves it from Home', async ({
  page, browser,
}) => {
  // 1. Sign in as accounting (seeded test user).
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(process.env.E2E_ACCOUNTING_EMAIL ?? 'accounting@example.com');
  await page.getByLabel(/password/i).fill(process.env.E2E_ACCOUNTING_PASSWORD ?? 'changeme');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/');

  // 2. Navigate to the seeded deal and open the Tasks tab.
  await page.goto(`/sales/clients`);
  await page.getByText(DEAL_CODE).first().click();
  await page.getByRole('tab', { name: /tasks/i }).click();

  // 3. Create a task assigned to the tech user.
  await page.getByRole('button', { name: /new task/i }).click();
  await page.getByLabel(/task title/i).fill('E2E renew domain');
  await page.getByLabel(/notes/i).fill('Before EOM');
  await page.getByLabel(/assign to/i).selectOption({ label: /tech/i });
  await page.getByRole('button', { name: /create/i }).click();

  // 4. The task appears in the Open section.
  await expect(page.getByText('E2E renew domain')).toBeVisible();

  // 5. Switch to tech user in a second browser context and resolve.
  const techContext = await browser.newContext();
  const techPage = await techContext.newPage();
  await techPage.goto('/login');
  await techPage.getByLabel(/email/i).fill(process.env.E2E_TECH_EMAIL ?? 'tech@example.com');
  await techPage.getByLabel(/password/i).fill(process.env.E2E_TECH_PASSWORD ?? 'changeme');
  await techPage.getByRole('button', { name: /sign in/i }).click();
  await techPage.waitForURL('/');

  // The task is in the Home column.
  await expect(techPage.getByText('E2E renew domain')).toBeVisible();
  await techPage.getByRole('button', { name: /resolve/i }).first().click();

  // It disappears from the Home column.
  await expect(techPage.getByText('E2E renew domain')).toHaveCount(0);

  // 6. Back in the accounting tab the task now appears under Resolved.
  await page.reload();
  await page.getByRole('tab', { name: /tasks/i }).click();
  await expect(
    page.getByRole('heading', { name: /resolved/i }).locator('..').getByText('E2E renew domain'),
  ).toBeVisible();

  await techContext.close();
});
```

- [ ] **Step 3: Run the spec**

Run: `npx playwright test tests/assigned-tasks-smoke.spec.ts`
Expected: PASS. If credentials are not seeded locally, set the `E2E_*` env vars or skip with `test.skip` until they exist.

- [ ] **Step 4: Commit**

```bash
git add tests/assigned-tasks-smoke.spec.ts
git commit -m "test(tasks): playwright smoke for create + assign + resolve flow"
```

---

## Task 16: Final manual verification + push

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npx eslint "src/features/assigned_tasks/**/*.{ts,tsx}" "src/app/routes/HomePage.tsx" "src/features/deals/DealDetailPage.tsx" "src/features/jobs/JobDetailPage.tsx"`
Expected: clean.

- [ ] **Step 3: Unit tests**

Run: `npx vitest run src/features/assigned_tasks`
Expected: all green.

- [ ] **Step 4: Manual run through**

Start dev (`npm run dev`) and walk this list in the browser:

1. Sign in as an accounting user → open any deal → **Tasks** tab → **+ New task** → fill title, description, assignee → **Create task** → row shows under **Open**.
2. Sign in (separate browser) as the assigned tech user → Home → see task in **Assigned to me** column with the deal code + company → **Resolve** → row disappears.
3. Back on the originating deal **Tasks** tab → reload → task now under **Resolved**.
4. Repeat 1–3 from a job detail page.
5. As an admin → Home → toggle to **All team** → see other people's open tasks.
6. As a sales user (no accounting / tech group) → open a deal → **Tasks** tab loads but **+ New task** is hidden.
7. Notification bell shows `task_assigned` for the assignee and `task_resolved` for the creator; clicking each routes to the deal or job.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: push succeeds. The feature is now live for the team.

---

## Self-Review Notes

- Spec coverage: title (Task 1, 10, 12) · auto ID from deal/job (`source_code` denormalised, Task 1) · company name (`client_id` denormalised + joined in the SELECT, Task 4) · description "area" (Task 1, 9) · status Open/Resolved (Task 1 CHECK constraint) · Open by default (Task 1 default `'open'`) · assignee resolves (Task 7 + Task 10/12 UI gates by `assignee_user_id === userId`) · row leaves Home on resolve (Task 4 query filters `status = 'open'`) · stored & visible in originating deal/job (Task 5 + Task 10 + Task 11). All covered.
- Type consistency verified: `AssignedTaskRow` is defined in Task 4 and reused in Task 5, 10, 12. Hook names match the file names. Query keys created in Task 2 are referenced in Tasks 4, 5, 6.
- No placeholders, every step has the code or command needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-12-assigned-tasks.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute the tasks sequentially in this session with checkpoints.

Which approach?
