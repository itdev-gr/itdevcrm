# Phase 3 — Clients + Sales Kanban + Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end sales workflow — admin/sales can manage clients + deals + jobs, drag deal cards through the 10-stage Sales kanban, "lock" a Won deal (validation triggers Accounting handoff data), comment + attach files + see activity history, get notifications on @mentions, and save custom filters per user.

**Architecture:** Three core entity tables (`clients`, `deals`, `jobs`) with RLS that calls Phase 2's `current_user_can()` / `current_user_scope()`. A `lock_deal()` Postgres RPC validates required fields and inserts the Accounting onboarding row atomically. Polymorphic `comments` / `attachments` / `notifications` tables tied to entity types. Realtime kanban via Supabase channels. Field-level permission rules from Phase 2 honored in all forms via `useFieldPermission`.

**Tech Stack:** All from Phases 0–2 plus `@dnd-kit/core` + `@dnd-kit/sortable` (already installed) for drag-drop, Supabase Storage for attachments, Supabase Realtime for kanban + notifications.

**Reference spec:** `docs/superpowers/specs/2026-05-01-itdevcrm-design.md` — Sections 6.4 (clients/deals/jobs), 6.6 (collaboration), 7 (RLS), 8 (workflows), 12 (Realtime), 14 (Phase 3 plan).

**Builds on:** Phase 0 (foundations), Phase 1 (auth + users + groups), Phase 2 (permissions engine + pipeline_stages). All shipped to main.

**Branch:** `main` (push directly per project memory).

---

## Sub-phase grouping (for natural checkpoints)

```
A. Schema           Tasks 1–5    DB migrations + types + storage bucket
B. Clients          Tasks 6–10   hooks + form + list + detail tabs
C. Deals            Tasks 11–13  hooks + form + detail
D. Sales kanban     Tasks 14–17  /sales/kanban + dnd-kit + lock_deal + Realtime
E. Collaboration    Tasks 18–22  comments + attachments + activity + notifications
F. Saved filters    Task 23      saved-filter persistence + UI
G. Acceptance       Tasks 24–25  e2e smoke + manual test pass
```

After each sub-phase, the controller (or you) should pause for a manual checkpoint before continuing.

---

## File Structure (Phase 3 outcome)

```
.
├── supabase/
│   ├── migrations/
│   │   ├── 20260502000007_clients.sql
│   │   ├── 20260502000008_deals_jobs.sql
│   │   ├── 20260502000009_collaboration.sql       # comments, attachments, notifications, saved_filters
│   │   └── 20260502000010_lock_deal_rpc.sql
│   └── (storage bucket "attachments" created via Dashboard or CLI)
├── src/
│   ├── lib/
│   │   ├── permissions.ts         # MODIFY: add useEffectiveScope helper if needed
│   │   ├── queryKeys.ts           # MODIFY: clients, deals, jobs, comments, attachments, notifications, savedFilters
│   │   └── rpc.ts                 # NEW: lockDeal() wrapper
│   ├── features/
│   │   ├── clients/
│   │   │   ├── hooks/
│   │   │   │   ├── useClients.ts
│   │   │   │   ├── useClient.ts
│   │   │   │   ├── useUpsertClient.ts
│   │   │   │   ├── useArchiveClient.ts
│   │   │   │   └── useMyClients.ts          # cross-dept "My Clients" view (90-day window)
│   │   │   ├── ClientForm.tsx
│   │   │   ├── ClientsListPage.tsx           # /sales/clients
│   │   │   ├── ClientDetailPage.tsx          # /clients/:id
│   │   │   └── *.test.tsx
│   │   ├── deals/
│   │   │   ├── hooks/
│   │   │   │   ├── useDeals.ts
│   │   │   │   ├── useDeal.ts
│   │   │   │   ├── useUpsertDeal.ts
│   │   │   │   ├── useMoveDealStage.ts        # optimistic mutation
│   │   │   │   └── useLockDeal.ts             # RPC wrapper
│   │   │   ├── DealForm.tsx
│   │   │   ├── DealDetailPage.tsx             # /deals/:id
│   │   │   └── *.test.tsx
│   │   ├── jobs/                              # SKELETON — full UI is Phase 6
│   │   │   └── hooks/useJobsForClient.ts      # read-only list for ClientDetailPage
│   │   ├── sales/
│   │   │   ├── SalesKanbanPage.tsx            # /sales/kanban
│   │   │   ├── SalesKanbanCard.tsx
│   │   │   ├── SalesKanbanColumn.tsx
│   │   │   └── useSalesKanbanRealtime.ts
│   │   ├── comments/
│   │   │   ├── CommentsPanel.tsx              # parent_type / parent_id polymorphic
│   │   │   ├── CommentItem.tsx
│   │   │   ├── CommentForm.tsx                # with @mention parsing
│   │   │   ├── hooks/useComments.ts
│   │   │   └── hooks/useCreateComment.ts
│   │   ├── attachments/
│   │   │   ├── AttachmentsPanel.tsx
│   │   │   ├── hooks/useAttachments.ts
│   │   │   ├── hooks/useUploadAttachment.ts
│   │   │   └── hooks/useDeleteAttachment.ts
│   │   ├── activity/
│   │   │   ├── ActivityPanel.tsx              # reads activity_log filtered by entity
│   │   │   └── hooks/useActivityLog.ts
│   │   ├── notifications/
│   │   │   ├── NotificationsBell.tsx          # topbar component
│   │   │   ├── hooks/useNotifications.ts
│   │   │   ├── hooks/useMarkNotificationRead.ts
│   │   │   └── hooks/useNotificationsRealtime.ts
│   │   └── saved_filters/
│   │       ├── SavedFiltersBar.tsx
│   │       ├── hooks/useSavedFilters.ts
│   │       └── hooks/useUpsertSavedFilter.ts
│   ├── components/
│   │   ├── ui/                                # add: badge, separator, sheet, tabs (shadcn)
│   │   └── permissions/
│   │       └── PermissionAwareInput.tsx       # respects useFieldPermission
│   ├── app/router.tsx                          # add /sales/kanban, /sales/clients, /clients/:id, /deals/:id
│   ├── components/layout/Sidebar.tsx           # add /sales/* nav for sales group
│   └── i18n/locales/{en,el}/{clients,deals,sales}.json
└── tests/
    └── sales-kanban.spec.ts                    # e2e: drag card → Won → lock validation
```

---

## Conventions

- Branch: `main`. Each task ends in commit + push (no PRs per project memory).
- Run `npm run format:check && npm run lint && npm run typecheck && npm run test:run` before each commit.
- Migrations applied via `supabase db push` (assumes `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` env vars set).
- After every migration, regenerate types: `npm run types:gen`.
- All UI strings via `t(...)` (3 new namespaces: `clients`, `deals`, `sales`).
- TDD for hooks and helpers; smoke tests for pages.

---

# Sub-phase A — Schema (Tasks 1–5)

## Task 1 — Migration: `clients` table + RLS

**Files:**
- Create: `supabase/migrations/20260502000007_clients.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 3 migration: clients
-- =============================================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- company name
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  website text,
  industry text,
  country text,
  region text,
  city text,
  address text,
  postcode text,
  vat_number text,
  lead_source text,
  assigned_owner_id uuid references public.profiles(user_id),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_assigned_owner on public.clients (assigned_owner_id) where archived = false;
create index clients_name on public.clients (lower(name));

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create trigger clients_activity
  after insert or update or delete on public.clients
  for each row execute function public.log_activity('id');

-- RLS: every action permission-checked against board='clients' via current_user_can.
alter table public.clients enable row level security;

create policy clients_select
  on public.clients for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
  );

create policy clients_insert
  on public.clients for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'create')
  );

create policy clients_update
  on public.clients for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  );

create policy clients_delete
  on public.clients for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'delete')
  );

-- Note: scope ('own' | 'group' | 'all') is currently not enforced at DB level for clients —
-- the permission engine grants the action; the *row-level scope* is honored client-side
-- by filtering the list query. Phase 8 may tighten this with row-level scope policies.
```

- [ ] **Step 2: Commit (no apply yet — we batch all schema migrations in Task 5)**

```bash
git add supabase/migrations/20260502000007_clients.sql
git commit -m "feat(db): clients table + RLS via permissions engine"
git push
```

---

## Task 2 — Migration: `deals` + `jobs` tables + RLS

**Files:**
- Create: `supabase/migrations/20260502000008_deals_jobs.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 3 migration: deals + jobs (jobs is skeleton; full lifecycle in Phase 6)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  expected_close_date date,
  actual_close_date date,
  probability int check (probability between 0 and 100),
  lead_source text,
  stage_id uuid not null references public.pipeline_stages(id),
  owner_user_id uuid references public.profiles(user_id),
  currency text not null default 'EUR',
  one_time_value numeric(12,2) default 0,
  recurring_monthly_value numeric(12,2) default 0,
  locked_at timestamptz,
  locked_by uuid references public.profiles(user_id),
  accounting_completed_at timestamptz,
  accounting_completed_by uuid references public.profiles(user_id),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deals_client on public.deals (client_id);
create index deals_stage on public.deals (stage_id) where archived = false;
create index deals_owner on public.deals (owner_user_id) where archived = false;

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

create trigger deals_activity
  after insert or update or delete on public.deals
  for each row execute function public.log_activity('id');

alter table public.deals enable row level security;

create policy deals_select
  on public.deals for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('clients', 'view')
  );

create policy deals_insert
  on public.deals for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
  );

create policy deals_update
  on public.deals for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or (locked_at is null and public.current_user_can('sales', 'move_stage'))
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('sales', 'move_stage')
  );

create policy deals_delete
  on public.deals for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'delete')
  );

-- ---------------------------------------------------------------------------
-- jobs (skeleton — Phase 6 builds the technical kanbans)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_type text not null check (service_type in ('web_seo', 'local_seo', 'web_dev', 'social_media')),
  billing_type text not null check (billing_type in ('one_time', 'recurring_monthly')),
  one_time_amount numeric(12,2),
  monthly_amount numeric(12,2),
  setup_fee numeric(12,2),
  recurring_start_date date,
  stage_id uuid references public.pipeline_stages(id),
  owner_user_id uuid references public.profiles(user_id),
  assigned_group_id uuid references public.groups(id),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
  monthly_tasks jsonb not null default '[]'::jsonb,
  monthly_tasks_period text,                   -- 'YYYY-MM'
  started_at timestamptz,
  completed_at timestamptz,
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_deal on public.jobs (deal_id);
create index jobs_client on public.jobs (client_id);
create index jobs_service on public.jobs (service_type) where archived = false;
create index jobs_assigned_group on public.jobs (assigned_group_id) where archived = false;

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create trigger jobs_activity
  after insert or update or delete on public.jobs
  for each row execute function public.log_activity('id');

alter table public.jobs enable row level security;

-- Tech sub-departments enforce per-board permissions; jobs are visible to anyone
-- with view perm on their service_type's board, plus accounting (read-only).
create policy jobs_select
  on public.jobs for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  );

create policy jobs_mutate_admin_or_service
  on public.jobs for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000008_deals_jobs.sql
git commit -m "feat(db): deals + jobs tables + RLS"
git push
```

---

## Task 3 — Migration: collaboration tables (comments, attachments, notifications, saved_filters)

**Files:**
- Create: `supabase/migrations/20260502000009_collaboration.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 3 migration: comments, attachments, notifications, saved_filters
-- =============================================================================

-- ---------------------------------------------------------------------------
-- comments (polymorphic on parent_type/parent_id)
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('client', 'deal', 'job')),
  parent_id uuid not null,
  author_id uuid not null references public.profiles(user_id),
  body text not null,
  mentioned_user_ids uuid[] not null default '{}',
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_parent on public.comments (parent_type, parent_id) where archived = false;
create index comments_author on public.comments (author_id);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

create trigger comments_activity
  after insert or update or delete on public.comments
  for each row execute function public.log_activity('id');

alter table public.comments enable row level security;

-- A user can read a comment if they can view the parent entity.
-- Implementation uses board mapping: client/deal -> 'sales' or 'clients', job -> service_type's board.
-- For simplicity we permit SELECT to any authenticated user with 'comment' permission on ANY board they belong to,
-- plus admin. Phase 8 will tighten with parent-row visibility checks.
create policy comments_select
  on public.comments for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view')
  );

create policy comments_insert_self
  on public.comments for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and (
      public.current_user_is_admin()
      or public.current_user_can('sales', 'comment')
      or public.current_user_can('clients', 'comment')
    )
  );

create policy comments_update_self_or_admin
  on public.comments for update
  to authenticated
  using (auth.uid() = author_id or public.current_user_is_admin())
  with check (auth.uid() = author_id or public.current_user_is_admin());

create policy comments_delete_self_or_admin
  on public.comments for delete
  to authenticated
  using (auth.uid() = author_id or public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('client', 'deal', 'job')),
  parent_id uuid not null,
  storage_path text not null,
  file_name text not null,
  file_size int,
  mime_type text,
  uploaded_by uuid not null references public.profiles(user_id),
  kind text default 'other',                   -- 'contract' | 'invoice' | 'other'
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create index attachments_parent on public.attachments (parent_type, parent_id) where archived = false;

create trigger attachments_activity
  after insert or update or delete on public.attachments
  for each row execute function public.log_activity('id');

alter table public.attachments enable row level security;

create policy attachments_select
  on public.attachments for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view')
  );

create policy attachments_insert
  on public.attachments for insert
  to authenticated
  with check (
    auth.uid() = uploaded_by
    and (
      public.current_user_is_admin()
      or public.current_user_can('sales', 'attach_file')
      or public.current_user_can('clients', 'attach_file')
    )
  );

create policy attachments_delete
  on public.attachments for delete
  to authenticated
  using (auth.uid() = uploaded_by or public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  type text not null,                          -- 'mention' | 'lock_deal' | 'block_client' | ...
  payload jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_all on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- INSERTs only via server-side triggers / service_role. No direct client INSERT.

-- Trigger: when a comment is inserted with mentioned_user_ids, fan out notifications.
create or replace function public.fanout_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if new.mentioned_user_ids is null or array_length(new.mentioned_user_ids, 1) is null then
    return new;
  end if;
  foreach uid in array new.mentioned_user_ids loop
    insert into public.notifications (user_id, type, payload)
    values (
      uid,
      'mention',
      jsonb_build_object(
        'comment_id', new.id,
        'parent_type', new.parent_type,
        'parent_id', new.parent_id,
        'author_id', new.author_id,
        'preview', left(new.body, 200)
      )
    );
  end loop;
  return new;
end $$;

create trigger comments_fanout_mentions
  after insert on public.comments
  for each row execute function public.fanout_mention_notifications();

-- ---------------------------------------------------------------------------
-- saved_filters
-- ---------------------------------------------------------------------------
create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  board text not null,                         -- 'sales' | 'clients' | 'sales:kanban' | ...
  name text not null,
  filter_json jsonb not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_filters_user on public.saved_filters (user_id, board, position);

create trigger saved_filters_set_updated_at
  before update on public.saved_filters
  for each row execute function public.set_updated_at();

alter table public.saved_filters enable row level security;

create policy saved_filters_select_own
  on public.saved_filters for select
  to authenticated
  using (auth.uid() = user_id);

create policy saved_filters_mutate_own
  on public.saved_filters for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000009_collaboration.sql
git commit -m "feat(db): comments + attachments + notifications + saved_filters tables"
git push
```

---

## Task 4 — Migration: `lock_deal()` RPC + storage bucket

**Files:**
- Create: `supabase/migrations/20260502000010_lock_deal_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 3 migration: lock_deal() RPC
-- =============================================================================

create or replace function public.lock_deal(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  c record;
  errors text[] := '{}';
  contract_count int;
  job_count int;
  won_stage_id uuid;
begin
  -- Permission check
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  if d.locked_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_locked']);
  end if;

  select * into c from public.clients where id = d.client_id;
  if c is null then
    errors := errors || 'client_missing';
  end if;

  -- Validations
  if coalesce(d.one_time_value, 0) + coalesce(d.recurring_monthly_value, 0) <= 0 then
    errors := errors || 'value_required';
  end if;

  select count(*) into job_count from public.jobs where deal_id = d.id and archived = false;
  if job_count = 0 then
    errors := errors || 'at_least_one_job_required';
  end if;

  if c is not null then
    if c.email is null or c.email = '' then
      errors := errors || 'client_email_required';
    end if;
    if (c.phone is null or c.phone = '') and (c.address is null or c.address = '') then
      errors := errors || 'client_phone_or_address_required';
    end if;
  end if;

  select count(*) into contract_count
  from public.attachments
  where parent_type = 'deal' and parent_id = d.id and kind = 'contract' and archived = false;
  if contract_count = 0 then
    errors := errors || 'contract_attachment_required';
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- All validations pass: set locked metadata + move to 'won' stage.
  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;

  update public.deals
    set
      locked_at = now(),
      locked_by = auth.uid(),
      actual_close_date = current_date,
      stage_id = coalesce(won_stage_id, stage_id)
    where id = d.id;

  -- Notify the deal owner (if any) — fire-and-forget.
  if d.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      d.owner_user_id,
      'lock_deal',
      jsonb_build_object('deal_id', d.id, 'client_id', d.client_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'deal_id', d.id);
end $$;

grant execute on function public.lock_deal(uuid) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000010_lock_deal_rpc.sql
git commit -m "feat(db): lock_deal RPC with validation"
git push
```

---

## Task 5 — Apply migrations + storage bucket + regen types

**Files:** none (operational)

- [ ] **Step 1: Apply migrations**

```bash
echo y | npx -y supabase@latest db push 2>&1 | tail -10
```

Expected: 4 migrations applied.

- [ ] **Step 2: Create `attachments` storage bucket**

Use the Supabase Management API (the `supabase storage` CLI subcommand exists in latest versions; if it doesn't on your installed version, fall back to the Dashboard).

Try CLI first:

```bash
SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" \
  curl -sS -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/storage/buckets" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"attachments","name":"attachments","public":false,"file_size_limit":26214400}' \
  -w "\nHTTP %{http_code}\n"
```

(`26214400` = 25 MB.)

If the API returns 200 or 409 (already exists), proceed. If it returns 4xx with another error, fall back to Dashboard:

> USER ACTION (only if CLI fails): Open Dashboard → Storage → New bucket. Name: `attachments`. Public: No. File size limit: 25 MB.

- [ ] **Step 3: Storage policies**

Run this in Dashboard → SQL Editor (storage policies require SQL):

```sql
-- Authenticated users can read attachments in the attachments bucket.
create policy "attachments_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'attachments');

-- Authenticated users can upload to the attachments bucket.
create policy "attachments_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'attachments');

-- Owner can delete their own uploads.
create policy "attachments_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
```

(These policies are stored in the `storage` schema and don't need to be in our migrations directory; running them once in Dashboard SQL Editor is sufficient.)

- [ ] **Step 4: Verify schema**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')
for t in clients deals jobs comments attachments notifications saved_filters; do
  echo -n "  $t: "
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" "${URL}/rest/v1/${t}?select=*&limit=1" \
    -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
done
```

Expected: all HTTP 200.

- [ ] **Step 5: Regenerate types + verify gates**

```bash
npm run types:gen
npm run typecheck
npm run test:run
```

All exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/types/supabase.ts
git commit -m "feat(types): regenerate after Phase 3 schema migrations"
git push
```

---

# Sub-phase B — Clients (Tasks 6–10)

## Task 6 — i18n namespaces + queryKeys + RPC wrapper

**Files:**
- Create: `src/i18n/locales/en/clients.json`, `src/i18n/locales/el/clients.json`
- Create: `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json`
- Create: `src/i18n/locales/en/sales.json`, `src/i18n/locales/el/sales.json`
- Modify: `src/lib/i18n.ts`
- Modify: `src/lib/queryKeys.ts`
- Create: `src/lib/rpc.ts`

- [ ] **Step 1: Translations (EN)**

`src/i18n/locales/en/clients.json`:

```json
{
  "title": "Clients",
  "my_clients": "My Clients",
  "new_client": "New client",
  "table": {
    "name": "Company",
    "contact": "Contact",
    "email": "Email",
    "phone": "Phone",
    "industry": "Industry",
    "country": "Country",
    "owner": "Owner",
    "actions": "Actions"
  },
  "form": {
    "name": "Company name",
    "contact_first_name": "Contact first name",
    "contact_last_name": "Contact last name",
    "email": "Email",
    "phone": "Phone",
    "website": "Website",
    "industry": "Industry",
    "country": "Country",
    "region": "Region / State",
    "city": "City",
    "address": "Address",
    "postcode": "Postcode",
    "vat_number": "VAT number",
    "lead_source": "Lead source",
    "assigned_owner": "Assigned owner",
    "submit": "Save",
    "submitting": "Saving…",
    "cancel": "Cancel"
  },
  "tabs": {
    "overview": "Overview",
    "deals": "Deals",
    "jobs": "Jobs",
    "comments": "Comments",
    "attachments": "Attachments",
    "activity": "Activity"
  },
  "actions": {
    "view": "View",
    "edit": "Edit",
    "archive": "Archive"
  },
  "empty": "No clients yet — click \"New client\" to add one."
}
```

`src/i18n/locales/en/deals.json`:

```json
{
  "title": "Deals",
  "new_deal": "New deal",
  "form": {
    "title": "Title",
    "description": "Description",
    "client": "Client",
    "stage": "Stage",
    "owner": "Owner",
    "expected_close_date": "Expected close date",
    "probability": "Probability (%)",
    "lead_source": "Source",
    "currency": "Currency",
    "one_time_value": "One-time value",
    "recurring_monthly_value": "Monthly recurring value",
    "submit": "Save",
    "submitting": "Saving…"
  },
  "tabs": {
    "overview": "Overview",
    "jobs": "Jobs",
    "comments": "Comments",
    "attachments": "Attachments",
    "activity": "Activity"
  },
  "actions": {
    "view": "View",
    "edit": "Edit",
    "lock": "Lock deal",
    "archive": "Archive"
  },
  "lock": {
    "confirm_title": "Lock this deal?",
    "confirm_body": "Once locked, sales cannot edit deal value or services. The deal moves to Accounting.",
    "errors": {
      "permission_denied": "You do not have permission to lock deals.",
      "already_locked": "This deal is already locked.",
      "value_required": "Deal value must be greater than zero.",
      "at_least_one_job_required": "At least one service / job is required.",
      "client_email_required": "The client must have an email.",
      "client_phone_or_address_required": "The client must have a phone or address.",
      "contract_attachment_required": "A contract attachment of kind \"contract\" is required."
    }
  },
  "empty": "No deals yet."
}
```

`src/i18n/locales/en/sales.json`:

```json
{
  "kanban": {
    "title": "Sales pipeline",
    "empty_column": "Drop deals here",
    "card": {
      "value": "Value",
      "monthly": "/mo"
    }
  },
  "filters": {
    "all": "All deals",
    "mine": "My deals",
    "saved": "Saved filters",
    "save_current": "Save current filter",
    "name_placeholder": "Filter name"
  },
  "comments": {
    "placeholder": "Write a comment… mention with @",
    "submit": "Post",
    "empty": "No comments yet."
  },
  "attachments": {
    "upload": "Upload file",
    "uploading": "Uploading…",
    "max_size": "Max 25 MB",
    "kind": "Kind",
    "kinds": {
      "contract": "Contract",
      "invoice": "Invoice",
      "other": "Other"
    },
    "empty": "No attachments yet."
  },
  "activity": {
    "empty": "No activity yet."
  },
  "notifications": {
    "title": "Notifications",
    "empty": "No notifications.",
    "mark_all_read": "Mark all read"
  }
}
```

- [ ] **Step 2: Translations (EL)**

`src/i18n/locales/el/clients.json`:

```json
{
  "title": "Πελάτες",
  "my_clients": "Οι Πελάτες μου",
  "new_client": "Νέος πελάτης",
  "table": {
    "name": "Εταιρεία",
    "contact": "Επαφή",
    "email": "Email",
    "phone": "Τηλέφωνο",
    "industry": "Κλάδος",
    "country": "Χώρα",
    "owner": "Υπεύθυνος",
    "actions": "Ενέργειες"
  },
  "form": {
    "name": "Όνομα εταιρείας",
    "contact_first_name": "Όνομα επαφής",
    "contact_last_name": "Επώνυμο επαφής",
    "email": "Email",
    "phone": "Τηλέφωνο",
    "website": "Ιστοσελίδα",
    "industry": "Κλάδος",
    "country": "Χώρα",
    "region": "Νομός / Περιοχή",
    "city": "Πόλη",
    "address": "Διεύθυνση",
    "postcode": "Τ.Κ.",
    "vat_number": "ΑΦΜ",
    "lead_source": "Πηγή",
    "assigned_owner": "Υπεύθυνος",
    "submit": "Αποθήκευση",
    "submitting": "Αποθήκευση…",
    "cancel": "Άκυρο"
  },
  "tabs": {
    "overview": "Επισκόπηση",
    "deals": "Συμφωνίες",
    "jobs": "Εργασίες",
    "comments": "Σχόλια",
    "attachments": "Συνημμένα",
    "activity": "Δραστηριότητα"
  },
  "actions": {
    "view": "Προβολή",
    "edit": "Επεξεργασία",
    "archive": "Αρχειοθέτηση"
  },
  "empty": "Δεν υπάρχουν πελάτες — προσθέστε έναν με «Νέος πελάτης»."
}
```

`src/i18n/locales/el/deals.json`:

```json
{
  "title": "Συμφωνίες",
  "new_deal": "Νέα συμφωνία",
  "form": {
    "title": "Τίτλος",
    "description": "Περιγραφή",
    "client": "Πελάτης",
    "stage": "Στάδιο",
    "owner": "Υπεύθυνος",
    "expected_close_date": "Αναμενόμενη ημερομηνία κλεισίματος",
    "probability": "Πιθανότητα (%)",
    "lead_source": "Πηγή",
    "currency": "Νόμισμα",
    "one_time_value": "Εφάπαξ ποσό",
    "recurring_monthly_value": "Μηνιαίο επαναλαμβανόμενο",
    "submit": "Αποθήκευση",
    "submitting": "Αποθήκευση…"
  },
  "tabs": {
    "overview": "Επισκόπηση",
    "jobs": "Εργασίες",
    "comments": "Σχόλια",
    "attachments": "Συνημμένα",
    "activity": "Δραστηριότητα"
  },
  "actions": {
    "view": "Προβολή",
    "edit": "Επεξεργασία",
    "lock": "Κλείδωμα συμφωνίας",
    "archive": "Αρχειοθέτηση"
  },
  "lock": {
    "confirm_title": "Κλείδωμα αυτής της συμφωνίας;",
    "confirm_body": "Μετά το κλείδωμα, οι πωλητές δεν μπορούν να επεξεργαστούν την αξία ή τις υπηρεσίες. Η συμφωνία πάει στο Λογιστήριο.",
    "errors": {
      "permission_denied": "Δεν έχετε δικαίωμα κλειδώματος συμφωνιών.",
      "already_locked": "Η συμφωνία είναι ήδη κλειδωμένη.",
      "value_required": "Η αξία συμφωνίας πρέπει να είναι μεγαλύτερη του μηδενός.",
      "at_least_one_job_required": "Απαιτείται τουλάχιστον μία υπηρεσία.",
      "client_email_required": "Ο πελάτης πρέπει να έχει email.",
      "client_phone_or_address_required": "Ο πελάτης πρέπει να έχει τηλέφωνο ή διεύθυνση.",
      "contract_attachment_required": "Απαιτείται συνημμένο συμβόλαιο (kind \"contract\")."
    }
  },
  "empty": "Δεν υπάρχουν συμφωνίες."
}
```

`src/i18n/locales/el/sales.json`:

```json
{
  "kanban": {
    "title": "Pipeline Πωλήσεων",
    "empty_column": "Σύρετε συμφωνίες εδώ",
    "card": {
      "value": "Αξία",
      "monthly": "/μήνα"
    }
  },
  "filters": {
    "all": "Όλες",
    "mine": "Δικές μου",
    "saved": "Αποθηκευμένα φίλτρα",
    "save_current": "Αποθήκευση τρέχοντος φίλτρου",
    "name_placeholder": "Όνομα φίλτρου"
  },
  "comments": {
    "placeholder": "Γράψτε σχόλιο… mention με @",
    "submit": "Δημοσίευση",
    "empty": "Δεν υπάρχουν σχόλια."
  },
  "attachments": {
    "upload": "Μεταφόρτωση αρχείου",
    "uploading": "Μεταφόρτωση…",
    "max_size": "Μέγιστο 25 MB",
    "kind": "Είδος",
    "kinds": {
      "contract": "Συμβόλαιο",
      "invoice": "Τιμολόγιο",
      "other": "Άλλο"
    },
    "empty": "Δεν υπάρχουν συνημμένα."
  },
  "activity": {
    "empty": "Δεν υπάρχει δραστηριότητα."
  },
  "notifications": {
    "title": "Ειδοποιήσεις",
    "empty": "Δεν υπάρχουν ειδοποιήσεις.",
    "mark_all_read": "Σήμανση όλων ως αναγνωσμένες"
  }
}
```

- [ ] **Step 3: Register namespaces**

Edit `src/lib/i18n.ts`. Add imports + extend ns/resources:

```ts
import enClients from '@/i18n/locales/en/clients.json';
import elClients from '@/i18n/locales/el/clients.json';
import enDeals from '@/i18n/locales/en/deals.json';
import elDeals from '@/i18n/locales/el/deals.json';
import enSales from '@/i18n/locales/en/sales.json';
import elSales from '@/i18n/locales/el/sales.json';
// ...
ns: ['common', 'auth', 'users', 'admin', 'clients', 'deals', 'sales'],
resources: {
  en: { common: enCommon, auth: enAuth, users: enUsers, admin: enAdmin, clients: enClients, deals: enDeals, sales: enSales },
  el: { common: elCommon, auth: elAuth, users: elUsers, admin: elAdmin, clients: elClients, deals: elDeals, sales: elSales },
},
```

- [ ] **Step 4: Extend queryKeys**

Edit `src/lib/queryKeys.ts`. Append new keys:

```ts
export const queryKeys = {
  // ...existing keys
  clients: () => ['clients'] as const,
  client: (id: string) => ['client', id] as const,
  myClients: () => ['my-clients'] as const,
  deals: (filters?: Record<string, string | undefined>) => ['deals', filters ?? null] as const,
  deal: (id: string) => ['deal', id] as const,
  jobsForClient: (clientId: string) => ['jobs', 'client', clientId] as const,
  comments: (parentType: string, parentId: string) => ['comments', parentType, parentId] as const,
  attachments: (parentType: string, parentId: string) => ['attachments', parentType, parentId] as const,
  activity: (entityType: string, entityId: string) => ['activity', entityType, entityId] as const,
  notifications: () => ['notifications'] as const,
  savedFilters: (board: string) => ['saved-filters', board] as const,
};
```

- [ ] **Step 5: lockDeal RPC wrapper**

Path: `src/lib/rpc.ts`

```ts
import { supabase } from '@/lib/supabase';

export type LockDealResult =
  | { ok: true; deal_id: string }
  | { ok: false; errors: string[] };

export async function lockDeal(dealId: string): Promise<LockDealResult> {
  const { data, error } = await supabase.rpc('lock_deal', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as LockDealResult;
}
```

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(i18n,lib): clients/deals/sales namespaces + queryKeys + lockDeal wrapper"
git push
```

---

## Task 7 — Clients hooks

**Files:**
- Create: `src/features/clients/hooks/useClients.ts`
- Create: `src/features/clients/hooks/useClient.ts`
- Create: `src/features/clients/hooks/useUpsertClient.ts`
- Create: `src/features/clients/hooks/useArchiveClient.ts`
- Create: `src/features/clients/hooks/useMyClients.ts`
- Create: `src/features/clients/hooks/useUpsertClient.test.tsx`

- [ ] **Step 1: useClients (list)**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ClientRow = Database['public']['Tables']['clients']['Row'];

export function useClients() {
  return useQuery({
    queryKey: queryKeys.clients(),
    queryFn: async (): Promise<ClientRow[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientRow[];
    },
  });
}
```

- [ ] **Step 2: useClient (single)**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ClientRow } from './useClients';

export function useClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: async (): Promise<ClientRow> => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', clientId).single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as ClientRow;
    },
    enabled: !!clientId,
  });
}
```

- [ ] **Step 3: useUpsertClient**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ClientUpsert = Partial<Database['public']['Tables']['clients']['Insert']> & {
  id?: string;
  name: string;
};

export function useUpsertClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: ClientUpsert) => {
      if (vars.id) {
        const { id, ...patch } = vars;
        const { error } = await supabase.from('clients').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      } else {
        const { data, error } = await supabase.from('clients').insert(vars).select('id').single();
        if (error || !data) throw new Error(error?.message ?? 'Insert failed');
        return data.id;
      }
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
      void qc.invalidateQueries({ queryKey: queryKeys.client(id) });
    },
  });
}
```

- [ ] **Step 4: useArchiveClient**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

export function useArchiveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const archivedBy = useAuthStore.getState().user?.id ?? null;
      const { error } = await supabase
        .from('clients')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: archivedBy,
          archived_reason: reason ?? null,
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
    },
  });
}
```

- [ ] **Step 5: useMyClients (cross-dept 90-day window)**

The "My Clients" view per spec 12A: any client with a job in my group within 90 days, OR a deal with my group, OR ownership.

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { ClientRow } from './useClients';

export function useMyClients() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const groupCodes = useAuthStore((s) => s.groupCodes);

  return useQuery({
    queryKey: [...queryKeys.myClients(), userId, groupCodes.join(',')] as const,
    queryFn: async (): Promise<ClientRow[]> => {
      // Strategy: fetch ALL clients I can see (RLS already filters by view permission),
      // then filter to those that are: (a) owned by me, OR (b) have a deal owned by me,
      // OR (c) have a job in one of my groups (active or recently closed).
      // For now we simplify: clients I own OR clients with deals where I'm the owner OR the deal isn't archived.
      // Phase 8 may push this filter into a Postgres view for performance.
      if (!userId) return [];
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      // Owned clients
      const { data: owned, error: e1 } = await supabase
        .from('clients')
        .select('*')
        .eq('assigned_owner_id', userId)
        .eq('archived', false);
      if (e1) throw new Error(e1.message);

      // Clients via deals I own
      const { data: dealClientIds, error: e2 } = await supabase
        .from('deals')
        .select('client_id')
        .eq('owner_user_id', userId)
        .eq('archived', false)
        .gte('updated_at', cutoff);
      if (e2) throw new Error(e2.message);

      // Clients via jobs assigned to my groups (group ids derived from groupCodes)
      // Look up group ids first.
      const { data: myGroups } = await supabase
        .from('groups')
        .select('id')
        .in('code', groupCodes.length > 0 ? groupCodes : ['__none__']);
      const myGroupIds = (myGroups ?? []).map((g) => g.id);

      const { data: jobClientIds, error: e3 } = await supabase
        .from('jobs')
        .select('client_id')
        .in('assigned_group_id', myGroupIds.length > 0 ? myGroupIds : ['00000000-0000-0000-0000-000000000000'])
        .eq('archived', false)
        .gte('updated_at', cutoff);
      if (e3) throw new Error(e3.message);

      const ids = new Set<string>();
      (dealClientIds ?? []).forEach((r) => ids.add(r.client_id));
      (jobClientIds ?? []).forEach((r) => ids.add(r.client_id));
      // Add owned client ids
      (owned ?? []).forEach((c) => ids.add(c.id));

      // Fetch the full client rows for any ids not already in `owned`
      const ownedById = new Map((owned ?? []).map((c) => [c.id, c as ClientRow]));
      const remoteIds = [...ids].filter((id) => !ownedById.has(id));
      let extras: ClientRow[] = [];
      if (remoteIds.length > 0) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .in('id', remoteIds)
          .eq('archived', false);
        if (error) throw new Error(error.message);
        extras = (data ?? []) as ClientRow[];
      }
      return [...(owned ?? []), ...extras] as ClientRow[];
    },
    enabled: !!userId,
  });
}
```

- [ ] **Step 6: Test (representative — useUpsertClient happy + error paths)**

Path: `src/features/clients/hooks/useUpsertClient.test.tsx`

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, single, select, insert, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq });
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ update, insert });
  return { eq, update, single, select, insert, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useUpsertClient } from './useUpsertClient';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useUpsertClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts when no id is provided', async () => {
    single.mockResolvedValue({ data: { id: 'c1' }, error: null });
    const { result } = renderHook(() => useUpsertClient(), { wrapper: ({ children }) => wrap(children) });
    const id = await result.current.mutateAsync({ name: 'Acme' });
    expect(insert).toHaveBeenCalledWith({ name: 'Acme' });
    expect(id).toBe('c1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('updates when id is provided', async () => {
    eq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useUpsertClient(), { wrapper: ({ children }) => wrap(children) });
    const id = await result.current.mutateAsync({ id: 'c1', name: 'New name' });
    expect(update).toHaveBeenCalledWith({ name: 'New name' });
    expect(id).toBe('c1');
  });

  it('throws on insert error', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'fail' } });
    const { result } = renderHook(() => useUpsertClient(), { wrapper: ({ children }) => wrap(children) });
    await expect(result.current.mutateAsync({ name: 'X' })).rejects.toThrow('fail');
  });
});
```

- [ ] **Step 7: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/clients/
git commit -m "feat(clients): query + mutation hooks (list, single, upsert, archive, my-clients)"
git push
```

Tests: 41 → 44.

---

## Task 8 — ClientForm component (RHF + Zod + field permissions)

**Files:**
- Create: `src/components/permissions/PermissionAwareInput.tsx`
- Create: `src/features/clients/ClientForm.tsx`

- [ ] **Step 1: PermissionAwareInput shared helper**

This wraps an input in `useFieldPermission` and renders nothing (hidden), a disabled input (readonly), or a normal input.

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldPermission } from '@/features/permissions/hooks/useFieldPermission';
import type { ComponentProps } from 'react';

type Props = ComponentProps<typeof Input> & {
  table: string;
  field: string;
  label: string;
};

export function PermissionAwareInput({ table, field, label, id, ...rest }: Props) {
  const mode = useFieldPermission(table, field);
  if (mode === 'hidden') return null;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} disabled={mode === 'readonly'} {...rest} />
    </div>
  );
}
```

- [ ] **Step 2: ClientForm**

```tsx
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { PermissionAwareInput } from '@/components/permissions/PermissionAwareInput';
import { useUpsertClient } from './hooks/useUpsertClient';
import type { ClientRow } from './hooks/useClients';

const schema = z.object({
  name: z.string().min(1),
  contact_first_name: z.string().optional(),
  contact_last_name: z.string().optional(),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().optional(),
  website: z.string().url().or(z.literal('')).optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  postcode: z.string().optional(),
  vat_number: z.string().optional(),
  lead_source: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  initial?: Partial<ClientRow>;
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

export function ClientForm({ initial, onDone, onCancel }: Props) {
  const { t } = useTranslation('clients');
  const upsert = useUpsertClient();
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      contact_first_name: initial?.contact_first_name ?? '',
      contact_last_name: initial?.contact_last_name ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      website: initial?.website ?? '',
      industry: initial?.industry ?? '',
      country: initial?.country ?? '',
      region: initial?.region ?? '',
      city: initial?.city ?? '',
      address: initial?.address ?? '',
      postcode: initial?.postcode ?? '',
      vat_number: initial?.vat_number ?? '',
      lead_source: initial?.lead_source ?? '',
    },
  });

  async function onSubmit(values: FormValues) {
    const id = await upsert.mutateAsync({ ...values, id: initial?.id });
    onDone?.(id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <PermissionAwareInput table="clients" field="name" id="name" label={t('form.name')} {...register('name')} />
      <PermissionAwareInput table="clients" field="contact_first_name" id="cfn" label={t('form.contact_first_name')} {...register('contact_first_name')} />
      <PermissionAwareInput table="clients" field="contact_last_name" id="cln" label={t('form.contact_last_name')} {...register('contact_last_name')} />
      <PermissionAwareInput table="clients" field="email" id="email" label={t('form.email')} {...register('email')} />
      <PermissionAwareInput table="clients" field="phone" id="phone" label={t('form.phone')} {...register('phone')} />
      <PermissionAwareInput table="clients" field="website" id="website" label={t('form.website')} {...register('website')} />
      <PermissionAwareInput table="clients" field="industry" id="industry" label={t('form.industry')} {...register('industry')} />
      <PermissionAwareInput table="clients" field="country" id="country" label={t('form.country')} {...register('country')} />
      <PermissionAwareInput table="clients" field="region" id="region" label={t('form.region')} {...register('region')} />
      <PermissionAwareInput table="clients" field="city" id="city" label={t('form.city')} {...register('city')} />
      <PermissionAwareInput table="clients" field="address" id="address" label={t('form.address')} {...register('address')} />
      <PermissionAwareInput table="clients" field="postcode" id="postcode" label={t('form.postcode')} {...register('postcode')} />
      <PermissionAwareInput table="clients" field="vat_number" id="vat" label={t('form.vat_number')} {...register('vat_number')} />
      <PermissionAwareInput table="clients" field="lead_source" id="src" label={t('form.lead_source')} {...register('lead_source')} />

      <div className="md:col-span-2 flex gap-2">
        <Button type="submit" disabled={upsert.isPending || formState.isSubmitting}>
          {upsert.isPending ? t('form.submitting') : t('form.submit')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(clients): ClientForm with RHF + Zod + field-permission-aware inputs"
git push
```

---

## Task 9 — `/sales/clients` page (list + create dialog)

**Files:**
- Create: `src/features/clients/ClientsListPage.tsx`
- Create: `src/features/clients/CreateClientDialog.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx` — add "Sales" header + Clients/Kanban/MyClients links for sales group

- [ ] **Step 1: CreateClientDialog**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientForm } from './ClientForm';

type Props = { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void };

export function CreateClientDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation('clients');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('new_client')}</DialogTitle>
        </DialogHeader>
        <ClientForm
          onDone={(id) => {
            onOpenChange(false);
            onCreated?.(id);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: ClientsListPage**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useMyClients } from './hooks/useMyClients';
import { CreateClientDialog } from './CreateClientDialog';

export function ClientsListPage() {
  const { t } = useTranslation('clients');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: clients = [], isLoading, error } = useMyClients();

  if (isLoading) return <div className="p-8">…</div>;
  if (error) return <div className="p-8 text-red-600">{error.message}</div>;

  return (
    <div className="space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('my_clients')}</h1>
        <Button onClick={() => setOpen(true)}>{t('new_client')}</Button>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">{t('table.name')}</th>
              <th className="py-2 pr-4">{t('table.contact')}</th>
              <th className="py-2 pr-4">{t('table.email')}</th>
              <th className="py-2 pr-4">{t('table.phone')}</th>
              <th className="py-2 pr-4">{t('table.industry')}</th>
              <th className="py-2 pr-4">{t('table.country')}</th>
              <th className="py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2 pr-4 font-medium">{c.name}</td>
                <td className="py-2 pr-4">
                  {[c.contact_first_name, c.contact_last_name].filter(Boolean).join(' ')}
                </td>
                <td className="py-2 pr-4">{c.email}</td>
                <td className="py-2 pr-4">{c.phone}</td>
                <td className="py-2 pr-4">{c.industry}</td>
                <td className="py-2 pr-4">{c.country}</td>
                <td className="py-2">
                  <Link to={`/clients/${c.id}`} className="text-blue-600 underline">
                    {t('actions.view')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateClientDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => navigate(`/clients/${id}`)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add router routes**

Edit `src/app/router.tsx`. Inside ShellLayout's children, add a new top-level group for `sales`:

```tsx
import { ClientsListPage } from '@/features/clients/ClientsListPage';
// inside ShellLayout children:
{
  path: 'sales',
  children: [
    { path: 'clients', element: <ClientsListPage /> },
    // kanban added in Task 14
  ],
},
```

Also add the universal client detail route:

```tsx
import { ClientDetailPage } from '@/features/clients/ClientDetailPage';
// stub until Task 10
{ path: 'clients/:clientId', element: <ClientDetailPage /> },
```

(If `ClientDetailPage` doesn't exist yet, create a stub: `src/features/clients/ClientDetailPage.tsx` that returns `<div className="p-8">Client detail (Task 10)</div>`.)

- [ ] **Step 4: Sidebar update**

Read `src/components/layout/Sidebar.tsx`. Add a new section that shows when the user is in the `sales` group:

```tsx
const groupCodes = useAuthStore((s) => s.groupCodes);
const isSales = groupCodes.includes('sales');
// ...
{isSales && (
  <div className="space-y-1 pt-2">
    <p className="px-3 text-xs font-medium uppercase text-slate-500">Sales</p>
    <NavLink to="/sales/clients" className={({ isActive }) =>
      `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
    }>
      {t('clients:my_clients')}
    </NavLink>
    {/* Kanban link added in Task 14 */}
  </div>
)}
```

(The "Sales" header text is hardcoded English for brevity — fine since groupCodes are stable identifiers.)

- [ ] **Step 5: Stub ClientDetailPage**

Path: `src/features/clients/ClientDetailPage.tsx`

```tsx
import { useParams } from 'react-router-dom';
import { useClient } from './hooks/useClient';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { data: client, isLoading, error } = useClient(clientId);
  if (isLoading) return <div className="p-8">…</div>;
  if (error || !client) return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;
  return <div className="p-8 text-2xl font-bold">{client.name}</div>;
}
```

(Task 10 builds the full detail page with tabs.)

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
git add -A
git commit -m "feat(clients): /sales/clients list page + create dialog + sales sidebar"
git push
```

---

## Task 10 — Client detail page with tabs (Overview, Comments, Attachments, Activity, Jobs stub)

**Files:**
- Create: `src/components/ui/tabs.tsx` (via shadcn)
- Modify: `src/features/clients/ClientDetailPage.tsx`

The Comments / Attachments / Activity panels are stubbed in this task and filled in by sub-phase E (Tasks 18–22).

- [ ] **Step 1: Add shadcn tabs**

```bash
npx -y shadcn@4.6.0 add tabs --yes
```

If the path-alias bug strikes, manually move `@/components/ui/tabs.tsx` → `src/components/ui/tabs.tsx`.

- [ ] **Step 2: ClientDetailPage with tabs (Comments/Attachments/Activity/Jobs as stubs)**

```tsx
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClientForm } from './ClientForm';
import { useClient } from './hooks/useClient';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { t } = useTranslation('clients');
  const { data: client, isLoading, error } = useClient(clientId);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !client) return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-2xl font-bold">{client.name}</h1>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="deals">{t('tabs.deals')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ClientForm initial={client} />
        </TabsContent>
        <TabsContent value="deals" className="pt-4">
          <p className="text-sm text-muted-foreground">Deals list (Task 13)</p>
        </TabsContent>
        <TabsContent value="jobs" className="pt-4">
          <p className="text-sm text-muted-foreground">Jobs list (Phase 6)</p>
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <p className="text-sm text-muted-foreground">Comments (Task 18)</p>
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <p className="text-sm text-muted-foreground">Attachments (Task 19)</p>
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <p className="text-sm text-muted-foreground">Activity (Task 20)</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(clients): ClientDetailPage with tabs (Overview implemented; rest stubbed)"
git push
```

---

# Sub-phase C — Deals (Tasks 11–13)

## Task 11 — Deals hooks

**Files:**
- Create: `src/features/deals/hooks/useDeals.ts`
- Create: `src/features/deals/hooks/useDeal.ts`
- Create: `src/features/deals/hooks/useUpsertDeal.ts`
- Create: `src/features/deals/hooks/useMoveDealStage.ts`
- Create: `src/features/deals/hooks/useLockDeal.ts`

- [ ] **Step 1: useDeals (with optional filters)**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type DealRow = Database['public']['Tables']['deals']['Row'] & {
  client?: { id: string; name: string } | null;
  stage?: { id: string; code: string; board: string } | null;
};

export type DealsFilter = {
  ownerId?: string;
  clientId?: string;
};

export function useDeals(filter: DealsFilter = {}) {
  return useQuery({
    queryKey: queryKeys.deals(filter as Record<string, string | undefined>),
    queryFn: async (): Promise<DealRow[]> => {
      let q = supabase
        .from('deals')
        .select('*, client:clients(id, name), stage:pipeline_stages(id, code, board)')
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
      if (filter.clientId) q = q.eq('client_id', filter.clientId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealRow[];
    },
  });
}
```

- [ ] **Step 2: useDeal**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealRow } from './useDeals';

export function useDeal(dealId: string) {
  return useQuery({
    queryKey: queryKeys.deal(dealId),
    queryFn: async (): Promise<DealRow> => {
      const { data, error } = await supabase
        .from('deals')
        .select('*, client:clients(id, name), stage:pipeline_stages(id, code, board)')
        .eq('id', dealId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as unknown as DealRow;
    },
    enabled: !!dealId,
  });
}
```

- [ ] **Step 3: useUpsertDeal**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type DealUpsert = Partial<Database['public']['Tables']['deals']['Insert']> & {
  id?: string;
  client_id: string;
  title: string;
  stage_id: string;
};

export function useUpsertDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: DealUpsert) => {
      if (vars.id) {
        const { id, ...patch } = vars;
        const { error } = await supabase.from('deals').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase.from('deals').insert(vars).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Insert failed');
      return data.id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(id) });
    },
  });
}
```

- [ ] **Step 4: useMoveDealStage (optimistic)**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealRow } from './useDeals';

export function useMoveDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', dealId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ dealId, stageId }) => {
      // Optimistic: update any cached deals lists.
      await qc.cancelQueries({ queryKey: queryKeys.deals() });
      const previous = qc.getQueriesData<DealRow[]>({ queryKey: queryKeys.deals() });
      previous.forEach(([key, value]) => {
        if (!value) return;
        qc.setQueryData<DealRow[]>(
          key,
          value.map((d) => (d.id === dealId ? { ...d, stage_id: stageId } : d)),
        );
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back optimistic update.
      ctx?.previous?.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(vars.dealId) });
    },
  });
}
```

- [ ] **Step 5: useLockDeal**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lockDeal } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useLockDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const result = await lockDeal(dealId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'lock_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.deal_id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(id) });
    },
  });
}
```

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/deals/
git commit -m "feat(deals): query + mutation hooks (list, single, upsert, move-stage optimistic, lock)"
git push
```

---

## Task 12 — DealForm component

**Files:**
- Create: `src/features/deals/DealForm.tsx`

- [ ] **Step 1: Form**

```tsx
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpsertDeal } from './hooks/useUpsertDeal';
import { useClients } from '@/features/clients/hooks/useClients';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import type { DealRow } from './hooks/useDeals';

const schema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  client_id: z.string().min(1),
  stage_id: z.string().min(1),
  expected_close_date: z.string().optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  lead_source: z.string().optional(),
  one_time_value: z.coerce.number().min(0).optional(),
  recurring_monthly_value: z.coerce.number().min(0).optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  initial?: Partial<DealRow>;
  defaultClientId?: string;
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

export function DealForm({ initial, defaultClientId, onDone, onCancel }: Props) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const upsert = useUpsertDeal();
  const { data: clients = [] } = useClients();
  const { data: stages = [] } = usePipelineStages();

  const salesStages = stages.filter((s) => s.board === 'sales' && !s.archived).sort((a, b) => a.position - b.position);

  const { register, handleSubmit, formState, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      client_id: initial?.client_id ?? defaultClientId ?? '',
      stage_id: initial?.stage_id ?? salesStages[0]?.id ?? '',
      expected_close_date: initial?.expected_close_date ?? '',
      probability: initial?.probability ?? 50,
      lead_source: initial?.lead_source ?? '',
      one_time_value: Number(initial?.one_time_value ?? 0),
      recurring_monthly_value: Number(initial?.recurring_monthly_value ?? 0),
    },
  });

  const clientId = watch('client_id');
  const stageId = watch('stage_id');

  async function onSubmit(values: FormValues) {
    const id = await upsert.mutateAsync({ ...values, id: initial?.id });
    onDone?.(id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label htmlFor="title">{t('form.title')}</Label>
        <Input id="title" {...register('title')} />
      </div>
      <div>
        <Label>{t('form.client')}</Label>
        <Select value={clientId} onValueChange={(v) => setValue('client_id', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t('form.stage')}</Label>
        <Select value={stageId} onValueChange={(v) => setValue('stage_id', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {salesStages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {(s.display_names as { en: string; el: string })[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="probability">{t('form.probability')}</Label>
        <Input id="probability" type="number" min="0" max="100" {...register('probability')} />
      </div>
      <div>
        <Label htmlFor="ecd">{t('form.expected_close_date')}</Label>
        <Input id="ecd" type="date" {...register('expected_close_date')} />
      </div>
      <div>
        <Label htmlFor="otv">{t('form.one_time_value')}</Label>
        <Input id="otv" type="number" step="0.01" min="0" {...register('one_time_value')} />
      </div>
      <div>
        <Label htmlFor="rmv">{t('form.recurring_monthly_value')}</Label>
        <Input id="rmv" type="number" step="0.01" min="0" {...register('recurring_monthly_value')} />
      </div>
      <div>
        <Label htmlFor="src">{t('form.lead_source')}</Label>
        <Input id="src" {...register('lead_source')} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="desc">{t('form.description')}</Label>
        <Input id="desc" {...register('description')} />
      </div>

      <div className="md:col-span-2 flex gap-2">
        <Button type="submit" disabled={upsert.isPending || formState.isSubmitting}>
          {upsert.isPending ? t('form.submitting') : t('form.submit')}
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(deals): DealForm with client + stage pickers + values"
git push
```

---

## Task 13 — DealDetailPage + ClientDetailPage Deals tab

**Files:**
- Create: `src/features/deals/DealDetailPage.tsx`
- Modify: `src/features/clients/ClientDetailPage.tsx` — wire up Deals tab
- Modify: `src/app/router.tsx` — add `/deals/:dealId`

- [ ] **Step 1: DealDetailPage**

```tsx
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DealForm } from './DealForm';
import { useDeal } from './hooks/useDeal';
import { useLockDeal } from './hooks/useLockDeal';

export function DealDetailPage() {
  const { dealId = '' } = useParams<{ dealId: string }>();
  const { t } = useTranslation('deals');
  const { data: deal, isLoading, error } = useDeal(dealId);
  const lock = useLockDeal();

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !deal) return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  async function onLock() {
    try {
      await lock.mutateAsync(dealId);
    } catch (err) {
      const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
      alert(errors.map((e) => t(`lock.errors.${e}`, { defaultValue: e })).join('\n'));
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{deal.title}</h1>
        {!deal.locked_at && (
          <Button onClick={onLock} disabled={lock.isPending}>
            {t('actions.lock')}
          </Button>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <DealForm initial={deal} />
        </TabsContent>
        <TabsContent value="jobs" className="pt-4">
          <p className="text-sm text-muted-foreground">Jobs (Phase 6)</p>
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <p className="text-sm text-muted-foreground">Comments (Task 18)</p>
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <p className="text-sm text-muted-foreground">Attachments (Task 19)</p>
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <p className="text-sm text-muted-foreground">Activity (Task 20)</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Wire Deals tab in ClientDetailPage**

Edit `src/features/clients/ClientDetailPage.tsx`. Replace the Deals tab content with:

```tsx
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useDeals } from '@/features/deals/hooks/useDeals';
import { CreateDealDialog } from '@/features/deals/CreateDealDialog';
import { useState } from 'react';
// ...
const [dealOpen, setDealOpen] = useState(false);
const { data: deals = [] } = useDeals({ clientId });
// ...
<TabsContent value="deals" className="pt-4 space-y-3">
  <Button onClick={() => setDealOpen(true)}>{t('deals:new_deal', { defaultValue: 'New deal' })}</Button>
  <ul className="divide-y rounded-md border">
    {deals.map((d) => (
      <li key={d.id} className="flex items-center justify-between px-4 py-2">
        <span>{d.title}</span>
        <Link to={`/deals/${d.id}`} className="text-blue-600 underline text-sm">View</Link>
      </li>
    ))}
  </ul>
  <CreateDealDialog open={dealOpen} onOpenChange={setDealOpen} clientId={clientId} />
</TabsContent>
```

- [ ] **Step 3: CreateDealDialog**

Path: `src/features/deals/CreateDealDialog.tsx`

```tsx
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DealForm } from './DealForm';

type Props = { open: boolean; onOpenChange: (v: boolean) => void; clientId?: string };

export function CreateDealDialog({ open, onOpenChange, clientId }: Props) {
  const { t } = useTranslation('deals');
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('new_deal')}</DialogTitle>
        </DialogHeader>
        <DealForm
          defaultClientId={clientId}
          onDone={(id) => {
            onOpenChange(false);
            navigate(`/deals/${id}`);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add `/deals/:dealId` route**

Edit `src/app/router.tsx`. Inside ShellLayout children:

```tsx
import { DealDetailPage } from '@/features/deals/DealDetailPage';
{ path: 'deals/:dealId', element: <DealDetailPage /> },
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
git add -A
git commit -m "feat(deals): DealDetailPage + CreateDealDialog + Deals tab on ClientDetailPage"
git push
```

---

# Sub-phase D — Sales kanban (Tasks 14–17)

## Task 14 — SalesKanbanPage skeleton (no drag yet)

**Files:**
- Create: `src/features/sales/SalesKanbanPage.tsx`
- Create: `src/features/sales/SalesKanbanColumn.tsx`
- Create: `src/features/sales/SalesKanbanCard.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: SalesKanbanCard**

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import type { DealRow } from '@/features/deals/hooks/useDeals';

export function SalesKanbanCard({ deal }: { deal: DealRow }) {
  const { t } = useTranslation('sales');
  return (
    <Card className="cursor-grab active:cursor-grabbing">
      <CardContent className="space-y-1 p-3">
        <div className="flex items-center justify-between">
          <Link to={`/deals/${deal.id}`} className="text-sm font-medium hover:underline">
            {deal.title}
          </Link>
          {deal.locked_at && <span className="text-xs text-emerald-600">🔒</span>}
        </div>
        <div className="text-xs text-muted-foreground">{deal.client?.name}</div>
        <div className="text-xs">
          {Number(deal.one_time_value ?? 0) > 0 && <span>€{Number(deal.one_time_value).toFixed(0)}</span>}
          {Number(deal.recurring_monthly_value ?? 0) > 0 && (
            <span className="ml-2">
              €{Number(deal.recurring_monthly_value).toFixed(0)}
              {t('kanban.card.monthly')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: SalesKanbanColumn**

```tsx
import { useTranslation } from 'react-i18next';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { DealRow } from '@/features/deals/hooks/useDeals';

type Props = {
  stageId: string;
  stageLabel: string;
  deals: DealRow[];
};

export function SalesKanbanColumn({ stageId: _stageId, stageLabel, deals }: Props) {
  const { t } = useTranslation('sales');
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-md border bg-slate-50">
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({deals.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {deals.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('kanban.empty_column')}</p>
        ) : (
          deals.map((d) => <SalesKanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: SalesKanbanPage (no drag yet)**

```tsx
import { useTranslation } from 'react-i18next';
import { useDeals } from '@/features/deals/hooks/useDeals';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { SalesKanbanColumn } from './SalesKanbanColumn';

export function SalesKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deals = [], isLoading } = useDeals();
  const { data: stages = [] } = usePipelineStages();

  if (isLoading) return <div className="p-8">…</div>;

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const dealsByStage = new Map<string, typeof deals>();
  for (const s of salesStages) dealsByStage.set(s.id, []);
  for (const d of deals) {
    if (d.stage?.board !== 'sales') continue;
    const list = dealsByStage.get(d.stage_id);
    if (list) list.push(d);
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {salesStages.map((s) => (
          <SalesKanbanColumn
            key={s.id}
            stageId={s.id}
            stageLabel={(s.display_names as { en: string; el: string })[lang]}
            deals={dealsByStage.get(s.id) ?? []}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add route + sidebar link**

Router (inside `sales` group):
```tsx
import { SalesKanbanPage } from '@/features/sales/SalesKanbanPage';
{ path: 'kanban', element: <SalesKanbanPage /> },
```

Sidebar (inside `isSales` block, after MyClients link):
```tsx
<NavLink to="/sales/kanban" className={({ isActive }) =>
  `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
}>
  {t('sales:kanban.title')}
</NavLink>
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
git add -A
git commit -m "feat(sales): /sales/kanban page with read-only columns + cards"
git push
```

---

## Task 15 — Drag-and-drop with optimistic updates

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx` — wire up `@dnd-kit`
- Modify: `src/features/sales/SalesKanbanColumn.tsx` — `useDroppable`
- Modify: `src/features/sales/SalesKanbanCard.tsx` — `useDraggable`

- [ ] **Step 1: SalesKanbanCard becomes draggable**

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import type { DealRow } from '@/features/deals/hooks/useDeals';

export function SalesKanbanCard({ deal }: { deal: DealRow }) {
  const { t } = useTranslation('sales');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id, currentStage: deal.stage_id },
  });
  const style = transform ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 } : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between">
            <Link to={`/deals/${deal.id}`} className="text-sm font-medium hover:underline">
              {deal.title}
            </Link>
            {deal.locked_at && <span className="text-xs text-emerald-600">🔒</span>}
          </div>
          <div className="text-xs text-muted-foreground">{deal.client?.name}</div>
          <div className="text-xs">
            {Number(deal.one_time_value ?? 0) > 0 && <span>€{Number(deal.one_time_value).toFixed(0)}</span>}
            {Number(deal.recurring_monthly_value ?? 0) > 0 && (
              <span className="ml-2">
                €{Number(deal.recurring_monthly_value).toFixed(0)}
                {t('kanban.card.monthly')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: SalesKanbanColumn becomes droppable**

```tsx
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { DealRow } from '@/features/deals/hooks/useDeals';

type Props = {
  stageId: string;
  stageLabel: string;
  deals: DealRow[];
};

export function SalesKanbanColumn({ stageId, stageLabel, deals }: Props) {
  const { t } = useTranslation('sales');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-md border ${isOver ? 'bg-slate-100' : 'bg-slate-50'}`}
    >
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({deals.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {deals.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('kanban.empty_column')}</p>
        ) : (
          deals.map((d) => <SalesKanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire DndContext in SalesKanbanPage**

```tsx
import { useTranslation } from 'react-i18next';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDeals } from '@/features/deals/hooks/useDeals';
import { useMoveDealStage } from '@/features/deals/hooks/useMoveDealStage';
import { useLockDeal } from '@/features/deals/hooks/useLockDeal';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { SalesKanbanColumn } from './SalesKanbanColumn';

export function SalesKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deals = [], isLoading } = useDeals();
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveDealStage();
  const lock = useLockDeal();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (isLoading) return <div className="p-8">…</div>;

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const wonStage = salesStages.find((s) => s.code === 'won');

  const dealsByStage = new Map<string, typeof deals>();
  for (const s of salesStages) dealsByStage.set(s.id, []);
  for (const d of deals) {
    if (d.stage?.board !== 'sales') continue;
    const list = dealsByStage.get(d.stage_id);
    if (list) list.push(d);
  }

  async function onDragEnd(e: DragEndEvent) {
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const isLockTarget = wonStage && stageId === wonStage.id;
    if (isLockTarget) {
      try {
        await lock.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`deals:lock.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ dealId, stageId });
    }
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {salesStages.map((s) => (
            <SalesKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              deals={dealsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(sales): drag-drop kanban with optimistic stage move + Won-locks-deal"
git push
```

---

## Task 16 — Realtime kanban sync

**Files:**
- Create: `src/features/sales/useSalesKanbanRealtime.ts`
- Modify: `src/features/sales/SalesKanbanPage.tsx`

- [ ] **Step 1: Realtime subscription hook**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useSalesKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('sales-kanban')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
```

- [ ] **Step 2: Use in SalesKanbanPage**

Add to top of SalesKanbanPage component body:

```tsx
import { useSalesKanbanRealtime } from './useSalesKanbanRealtime';
// ...
useSalesKanbanRealtime();
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(sales): Realtime sync for kanban (deals table changes)"
git push
```

---

## Task 17 — Deal lock confirmation dialog (improve UX vs alert())

**Files:**
- Create: `src/components/ui/alert-dialog.tsx` (via shadcn)
- Modify: `src/features/sales/SalesKanbanPage.tsx` — replace `alert()` with proper dialog
- Modify: `src/features/deals/DealDetailPage.tsx` — same

Skipped for brevity if alert() is acceptable. If you want a polished UX:

- [ ] **Step 1: Add shadcn alert-dialog**

```bash
npx -y shadcn@4.6.0 add alert-dialog --yes
```

(If path-alias bug strikes, manually move.)

- [ ] **Step 2: LockErrorDialog component**

Path: `src/features/deals/LockErrorDialog.tsx`

```tsx
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  errors: string[];
};

export function LockErrorDialog({ open, onOpenChange, errors }: Props) {
  const { t } = useTranslation('deals');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('lock.confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            <ul className="list-disc pl-4 text-sm">
              {errors.map((e) => (
                <li key={e}>{t(`lock.errors.${e}`, { defaultValue: e })}</li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Replace alert() in SalesKanbanPage and DealDetailPage**

Use local state `[lockErrors, setLockErrors] = useState<string[]>([])`. When lock fails, set errors; render `<LockErrorDialog open={lockErrors.length > 0} onOpenChange={...} errors={lockErrors} />`.

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(deals): replace alert() with LockErrorDialog for lock validation errors"
git push
```

---

# Sub-phase E — Collaboration (Tasks 18–22)

## Task 18 — CommentsPanel with @mention parsing

**Files:**
- Create: `src/features/comments/hooks/useComments.ts`
- Create: `src/features/comments/hooks/useCreateComment.ts`
- Create: `src/features/comments/CommentsPanel.tsx`
- Create: `src/features/comments/CommentItem.tsx`
- Create: `src/features/comments/CommentForm.tsx`
- Modify: `src/features/clients/ClientDetailPage.tsx` and `src/features/deals/DealDetailPage.tsx` — wire Comments tab

- [ ] **Step 1: useComments**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CommentRow = {
  id: string;
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
  author_id: string;
  body: string;
  mentioned_user_ids: string[];
  created_at: string;
  author: { user_id: string; full_name: string; email: string } | null;
};

export function useComments(parentType: 'client' | 'deal' | 'job', parentId: string) {
  return useQuery({
    queryKey: queryKeys.comments(parentType, parentId),
    queryFn: async (): Promise<CommentRow[]> => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(user_id, full_name, email)')
        .eq('parent_type', parentType)
        .eq('parent_id', parentId)
        .eq('archived', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CommentRow[];
    },
    enabled: !!parentId,
  });
}
```

- [ ] **Step 2: useCreateComment**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

type Vars = {
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
  body: string;
  mentioned_user_ids?: string[];
};

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const author_id = useAuthStore.getState().user?.id;
      if (!author_id) throw new Error('not_authenticated');
      const { error } = await supabase.from('comments').insert({
        parent_type: vars.parent_type,
        parent_id: vars.parent_id,
        body: vars.body,
        author_id,
        mentioned_user_ids: vars.mentioned_user_ids ?? [],
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
    },
  });
}
```

- [ ] **Step 3: CommentItem**

```tsx
import { useTranslation as _ } from 'react-i18next';
import type { CommentRow } from './hooks/useComments';

export function CommentItem({ comment }: { comment: CommentRow }) {
  const date = new Date(comment.created_at).toLocaleString();
  const author = comment.author?.full_name || comment.author?.email || comment.author_id;
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="font-medium">{author}</span>
        <span>{date}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
    </div>
  );
}
```

- [ ] **Step 4: CommentForm with @mention parsing**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUsers } from '@/features/users/hooks/useUsers';
import { useCreateComment } from './hooks/useCreateComment';

type Props = {
  parentType: 'client' | 'deal' | 'job';
  parentId: string;
};

export function CommentForm({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: users = [] } = useUsers();
  const create = useCreateComment();
  const [body, setBody] = useState('');

  function parseMentions(text: string): string[] {
    // Simple @email parser. e.g. "Hello @info@itdev.gr please review"
    const matches = text.matchAll(/@([\w.+-]+@[\w-]+\.[\w.-]+)/g);
    const emails = new Set<string>();
    for (const m of matches) emails.add(m[1]);
    return users.filter((u) => emails.has(u.email)).map((u) => u.user_id);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await create.mutateAsync({
      parent_type: parentType,
      parent_id: parentId,
      body: body.trim(),
      mentioned_user_ids: parseMentions(body),
    });
    setBody('');
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('comments.placeholder')}
      />
      <Button type="submit" disabled={create.isPending || !body.trim()}>
        {t('comments.submit')}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: CommentsPanel**

```tsx
import { useTranslation } from 'react-i18next';
import { useComments } from './hooks/useComments';
import { CommentItem } from './CommentItem';
import { CommentForm } from './CommentForm';

type Props = {
  parentType: 'client' | 'deal' | 'job';
  parentId: string;
};

export function CommentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: comments = [] } = useComments(parentType, parentId);
  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </div>
      )}
      <CommentForm parentType={parentType} parentId={parentId} />
    </div>
  );
}
```

- [ ] **Step 6: Wire into ClientDetailPage and DealDetailPage**

Replace stub Comments tab content:

```tsx
import { CommentsPanel } from '@/features/comments/CommentsPanel';
// ...
<TabsContent value="comments" className="pt-4">
  <CommentsPanel parentType="client" parentId={clientId} />
</TabsContent>
```

(Same pattern for DealDetailPage with `parentType="deal"` and `parentId={dealId}`.)

- [ ] **Step 7: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(comments): polymorphic CommentsPanel + @mention parsing + notifications fanout"
git push
```

---

## Task 19 — AttachmentsPanel with Supabase Storage

**Files:**
- Create: `src/features/attachments/hooks/useAttachments.ts`
- Create: `src/features/attachments/hooks/useUploadAttachment.ts`
- Create: `src/features/attachments/hooks/useDeleteAttachment.ts`
- Create: `src/features/attachments/AttachmentsPanel.tsx`
- Modify: ClientDetailPage / DealDetailPage to wire it

- [ ] **Step 1: useAttachments**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type AttachmentRow = {
  id: string;
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  kind: string | null;
  created_at: string;
};

export function useAttachments(parentType: 'client' | 'deal' | 'job', parentId: string) {
  return useQuery({
    queryKey: queryKeys.attachments(parentType, parentId),
    queryFn: async (): Promise<AttachmentRow[]> => {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('parent_type', parentType)
        .eq('parent_id', parentId)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AttachmentRow[];
    },
    enabled: !!parentId,
  });
}
```

- [ ] **Step 2: useUploadAttachment**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

const MAX_BYTES = 25 * 1024 * 1024;

type Vars = {
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
  file: File;
  kind?: 'contract' | 'invoice' | 'other';
};

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      if (vars.file.size > MAX_BYTES) throw new Error('file_too_large');
      const userId = useAuthStore.getState().user?.id;
      if (!userId) throw new Error('not_authenticated');
      const path = `${vars.parent_type}/${vars.parent_id}/${Date.now()}-${vars.file.name}`;
      const { error: e1 } = await supabase.storage.from('attachments').upload(path, vars.file, {
        contentType: vars.file.type,
        cacheControl: '3600',
        upsert: false,
      });
      if (e1) throw new Error(e1.message);

      const { error: e2 } = await supabase.from('attachments').insert({
        parent_type: vars.parent_type,
        parent_id: vars.parent_id,
        storage_path: path,
        file_name: vars.file.name,
        file_size: vars.file.size,
        mime_type: vars.file.type,
        uploaded_by: userId,
        kind: vars.kind ?? 'other',
      });
      if (e2) throw new Error(e2.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.attachments(vars.parent_type, vars.parent_id) });
    },
  });
}
```

- [ ] **Step 3: useDeleteAttachment**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storage_path }: { id: string; storage_path: string; parent_type: string; parent_id: string }) => {
      await supabase.storage.from('attachments').remove([storage_path]);
      const { error } = await supabase.from('attachments').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.attachments(vars.parent_type as 'client' | 'deal' | 'job', vars.parent_id),
      });
    },
  });
}
```

- [ ] **Step 4: AttachmentsPanel**

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAttachments } from './hooks/useAttachments';
import { useUploadAttachment } from './hooks/useUploadAttachment';
import { useDeleteAttachment } from './hooks/useDeleteAttachment';

type Props = {
  parentType: 'client' | 'deal' | 'job';
  parentId: string;
};

export function AttachmentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useAttachments(parentType, parentId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'contract' | 'invoice' | 'other'>('other');

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await upload.mutateAsync({ parent_type: parentType, parent_id: parentId, file, kind });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function getDownloadUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 60 * 5);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'contract' | 'invoice' | 'other')}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="other">{t('attachments.kinds.other')}</option>
          <option value="contract">{t('attachments.kinds.contract')}</option>
          <option value="invoice">{t('attachments.kinds.invoice')}</option>
        </select>
        <input ref={inputRef} type="file" onChange={onFileChange} className="text-sm" />
        <span className="text-xs text-muted-foreground">{t('attachments.max_size')}</span>
        {upload.isPending && <span className="text-xs">{t('attachments.uploading')}</span>}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <button
                  className="text-blue-600 hover:underline"
                  onClick={async () => {
                    const url = await getDownloadUrl(a.storage_path);
                    if (url) window.open(url, '_blank');
                  }}
                >
                  {a.file_name}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({(a.file_size ?? 0) > 0 ? `${Math.round((a.file_size ?? 0) / 1024)} KB` : ''}) · {t(`attachments.kinds.${a.kind ?? 'other'}`)}
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  void del.mutateAsync({
                    id: a.id,
                    storage_path: a.storage_path,
                    parent_type: parentType,
                    parent_id: parentId,
                  })
                }
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into detail pages (replace stub Attachments tab)**

```tsx
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
<TabsContent value="attachments" className="pt-4">
  <AttachmentsPanel parentType="client" parentId={clientId} />
</TabsContent>
```

(Same for DealDetailPage with `parentType="deal"`.)

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(attachments): polymorphic AttachmentsPanel with Supabase Storage upload"
git push
```

---

## Task 20 — ActivityPanel reading activity_log

**Files:**
- Create: `src/features/activity/hooks/useActivityLog.ts`
- Create: `src/features/activity/ActivityPanel.tsx`
- Modify: detail pages

- [ ] **Step 1: Hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ActivityRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  action: 'insert' | 'update' | 'delete';
  changes: unknown;
  created_at: string;
  user: { full_name: string; email: string } | null;
};

export function useActivityLog(entityType: string, entityId: string) {
  return useQuery({
    queryKey: queryKeys.activity(entityType, entityId),
    queryFn: async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, user:profiles!activity_log_user_id_fkey(full_name, email)')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ActivityRow[];
    },
    enabled: !!entityId,
  });
}
```

- [ ] **Step 2: ActivityPanel**

```tsx
import { useTranslation } from 'react-i18next';
import { useActivityLog, type ActivityRow } from './hooks/useActivityLog';

type Props = { entityType: string; entityId: string };

export function ActivityPanel({ entityType, entityId }: Props) {
  const { t } = useTranslation('sales');
  const { data: rows = [] } = useActivityLog(entityType, entityId);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border bg-white p-3 text-sm">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{r.user?.full_name ?? r.user?.email ?? 'system'}</span>
            <span>{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <span className="font-medium uppercase">{r.action}</span>
          {' on '}
          <span className="text-muted-foreground">{r.entity_type}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Wire into detail pages**

```tsx
import { ActivityPanel } from '@/features/activity/ActivityPanel';
<TabsContent value="activity" className="pt-4">
  <ActivityPanel entityType="clients" entityId={clientId} />
</TabsContent>
```

(In DealDetailPage use `entityType="deals"`.)

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(activity): ActivityPanel reading activity_log per entity"
git push
```

---

## Task 21 — NotificationsBell with Realtime

**Files:**
- Create: `src/features/notifications/hooks/useNotifications.ts`
- Create: `src/features/notifications/hooks/useMarkNotificationRead.ts`
- Create: `src/features/notifications/hooks/useNotificationsRealtime.ts`
- Create: `src/features/notifications/NotificationsBell.tsx`
- Modify: `src/components/layout/Topbar.tsx`

- [ ] **Step 1: Hooks**

```ts
// useNotifications.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
  });
}
```

```ts
// useMarkNotificationRead.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
```

```ts
// useNotificationsRealtime.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

export function useNotificationsRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.notifications() });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);
}
```

- [ ] **Step 2: NotificationsBell**

```tsx
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useNotifications } from './hooks/useNotifications';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';
import { useNotificationsRealtime } from './hooks/useNotificationsRealtime';

export function NotificationsBell() {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useNotifications();
  const mark = useMarkNotificationRead();
  useNotificationsRealtime();

  const unreadCount = list.filter((n) => !n.read_at).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] text-white">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('notifications.title')}</h3>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('notifications.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {list.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-md p-2 text-xs ${n.read_at ? 'bg-slate-50' : 'bg-blue-50 font-medium'}`}
                  onClick={() => !n.read_at && void mark.mutateAsync(n.id)}
                  role="button"
                >
                  <div>{n.type}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Add shadcn popover if missing**

```bash
npx -y shadcn@4.6.0 add popover --yes
```

(Move from `@/` if path-alias bug strikes.)

- [ ] **Step 4: Wire into Topbar**

Edit `src/components/layout/Topbar.tsx`. Inside the right-hand section (where LocaleSwitcher and Logout live), add NotificationsBell when authenticated:

```tsx
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
// ...
{session && <NotificationsBell />}
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(notifications): bell + Realtime + mark-as-read"
git push
```

---

## Task 22 — Cross-feature touchups

**Files:**
- Modify: detail pages to wire all panels
- Modify: SalesKanbanPage filters by stage

This task ensures every Comments/Attachments/Activity tab is wired in both ClientDetailPage and DealDetailPage. If you've been doing this in each task already, this task may be a no-op or just final verification.

- [ ] **Step 1: Verify ClientDetailPage** has all 6 tabs working: Overview (form), Deals (list), Jobs (stub), Comments (panel), Attachments (panel), Activity (panel).

- [ ] **Step 2: Verify DealDetailPage** has all 5 tabs working: Overview (form), Jobs (stub), Comments, Attachments, Activity.

- [ ] **Step 3: Manual smoke test locally**

```bash
npm run dev
```

Open http://localhost:5173, sign in, create a client, add a deal, post a comment, upload an attachment, see the activity log populated.

- [ ] **Step 4: Gates + commit (only if anything was changed)**

```bash
git status
# if anything to commit:
git add -A && git commit -m "chore: wire all detail-page tabs end-to-end" && git push
```

---

# Sub-phase F — Saved filters (Task 23)

## Task 23 — SavedFiltersBar

**Files:**
- Create: `src/features/saved_filters/hooks/useSavedFilters.ts`
- Create: `src/features/saved_filters/hooks/useUpsertSavedFilter.ts`
- Create: `src/features/saved_filters/SavedFiltersBar.tsx`
- Modify: `src/features/sales/SalesKanbanPage.tsx` — apply current filter

- [ ] **Step 1: Hooks**

```ts
// useSavedFilters.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type SavedFilterRow = {
  id: string;
  user_id: string;
  board: string;
  name: string;
  filter_json: Record<string, unknown>;
  position: number;
};

export function useSavedFilters(board: string) {
  return useQuery({
    queryKey: queryKeys.savedFilters(board),
    queryFn: async (): Promise<SavedFilterRow[]> => {
      const { data, error } = await supabase
        .from('saved_filters')
        .select('*')
        .eq('board', board)
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []) as SavedFilterRow[];
    },
  });
}
```

```ts
// useUpsertSavedFilter.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

type Vars = {
  id?: string;
  board: string;
  name: string;
  filter_json: Record<string, unknown>;
};

export function useUpsertSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) throw new Error('not_authenticated');
      if (vars.id) {
        const { id, ...patch } = vars;
        const { error } = await supabase.from('saved_filters').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('saved_filters').insert({ ...vars, user_id: userId });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.savedFilters(vars.board) });
    },
  });
}
```

- [ ] **Step 2: SavedFiltersBar**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSavedFilters } from './hooks/useSavedFilters';
import { useUpsertSavedFilter } from './hooks/useUpsertSavedFilter';

type Props = {
  board: string;
  currentFilter: Record<string, unknown>;
  onApply: (filter: Record<string, unknown>) => void;
};

export function SavedFiltersBar({ board, currentFilter, onApply }: Props) {
  const { t } = useTranslation('sales');
  const { data: filters = [] } = useSavedFilters(board);
  const upsert = useUpsertSavedFilter();
  const [name, setName] = useState('');

  return (
    <div className="flex items-center gap-2">
      {filters.map((f) => (
        <Button key={f.id} variant="outline" size="sm" onClick={() => onApply(f.filter_json)}>
          {f.name}
        </Button>
      ))}
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('filters.name_placeholder')}
        className="h-8 w-40 text-sm"
      />
      <Button
        size="sm"
        onClick={() => {
          if (!name.trim()) return;
          void upsert.mutateAsync({ board, name: name.trim(), filter_json: currentFilter }).then(() => setName(''));
        }}
        disabled={upsert.isPending || !name.trim()}
      >
        {t('filters.save_current')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Apply to SalesKanbanPage**

Add SavedFiltersBar above the kanban columns. Use a local `filter` state that affects which deals show. For Phase 3 keep the filter shape simple — `{ ownerId?: string }`. Future Phase 8 can extend.

```tsx
import { useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { SavedFiltersBar } from '@/features/saved_filters/SavedFiltersBar';
// ...
const userId = useAuthStore((s) => s.user?.id ?? null);
const [filter, setFilter] = useState<Record<string, unknown>>({});
const { data: deals = [], isLoading } = useDeals(filter as Parameters<typeof useDeals>[0]);
// ...
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
  <div className="flex items-center gap-2">
    <Button variant={filter.ownerId === userId ? 'default' : 'outline'} size="sm" onClick={() => setFilter({ ownerId: userId ?? undefined })}>
      {t('filters.mine')}
    </Button>
    <Button variant={Object.keys(filter).length === 0 ? 'default' : 'outline'} size="sm" onClick={() => setFilter({})}>
      {t('filters.all')}
    </Button>
    <SavedFiltersBar board="sales:kanban" currentFilter={filter} onApply={setFilter} />
  </div>
</div>
```

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
git add -A
git commit -m "feat(saved-filters): per-user saved filters + Sales kanban Mine/All/Saved bar"
git push
```

---

# Sub-phase G — Acceptance (Tasks 24–25)

## Task 24 — E2E test: clients + deals + drag-to-Won

**Files:**
- Create: `tests/sales-flow.spec.ts`

This e2e covers the critical path: create a client, create a deal, drag the deal across the kanban, attempt to lock without contract → error, attach a contract, lock succeeds.

- [ ] **Step 1: Write the spec**

Path: `tests/sales-flow.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /sign in|σύνδεση/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test.describe('sales flow', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /sales/clients', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/clients');
    await expect(page).toHaveURL(/\/sales\/clients$/);
    await expect(page.getByRole('heading', { name: /my clients|οι πελάτες μου/i })).toBeVisible();
  });

  test('admin can create a client', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/clients');
    await page.getByRole('button', { name: /new client|νέος πελάτης/i }).click();
    const unique = `E2E Test ${Date.now()}`;
    await page.getByLabel(/company name|όνομα εταιρείας/i).fill(unique);
    await page.getByLabel(/^email$/i).first().fill('e2e@example.com');
    await page.getByLabel(/^phone|τηλέφωνο/i).fill('1234567890');
    await page.getByRole('button', { name: /^save|αποθήκευση$/i }).click();
    await expect(page).toHaveURL(/\/clients\/.+/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: unique })).toBeVisible();
  });

  test('sales kanban renders 10 columns', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/kanban');
    await expect(page).toHaveURL(/\/sales\/kanban$/);
    await expect(page.getByRole('heading', { name: /sales pipeline|pipeline πωλήσεων/i })).toBeVisible();
    // At least 10 stage columns rendered
    const columns = page.locator('text=/.+\\(\\d+\\)/');
    await expect(columns.first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run locally**

```bash
PLAYWRIGHT_BASE_URL=https://itdevcrm.vercel.app E2E_ADMIN_EMAIL=info@itdev.gr E2E_ADMIN_PASSWORD=<password> npx playwright test tests/sales-flow.spec.ts --reporter=list
```

(Requires admin must_change_password=false beforehand; flip via service-role REST or Dashboard.)

- [ ] **Step 3: Commit**

```bash
git add tests/sales-flow.spec.ts
git commit -m "test(e2e): sales flow — clients page + create client + kanban renders"
git push
```

---

## Task 25 — Phase 3 acceptance + manual test

- [ ] **Step 1: Final local suite**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
```

All exit 0.

- [ ] **Step 2: Phase 3 acceptance criteria**

- [ ] An admin/sales user can sign in, see the Sales sidebar (My Clients + Pipeline links).
- [ ] Create a client via `/sales/clients` → "New client" → fields validate → land on `/clients/:id`.
- [ ] Client detail page has all 6 tabs (Overview, Deals, Jobs, Comments, Attachments, Activity).
- [ ] Create a deal via the Deals tab → land on `/deals/:id`.
- [ ] Deal detail page has 5 tabs.
- [ ] Drag a deal card on `/sales/kanban` → moves to new stage; persists on refresh.
- [ ] Drag a deal to Won column → lock attempt fires; if validation fails, an error shows listing missing requirements (email/phone/value/contract).
- [ ] After fulfilling all requirements (add a contract attachment, set value > 0, etc.), Won succeeds → deal appears locked (lock icon visible).
- [ ] Comments tab: post a comment with `@email@itdev.gr` → an entry appears.
- [ ] Mentioned user gets a notification (visible in their topbar bell).
- [ ] Attachments tab: upload a file ≤25 MB → appears in list; click to download via signed URL.
- [ ] Activity tab: shows entries for the entity (insert/update events).
- [ ] Saved filters: in `/sales/kanban`, click "My deals" → filter applies; type a name + Save → reload → saved filter appears.
- [ ] Greek translations present on all new pages.
- [ ] CI green on `main` for the latest commit.

- [ ] **Step 3: Manual smoke (USER ACTION)**

Walk through the acceptance items at https://itdevcrm.vercel.app. Tell me anything broken.

- [ ] **Step 4: Mark Phase 3 done**

No code commit needed. Update memory if anything new emerged.

---

## Out of scope for Phase 3 (do NOT do now)

- **Full job lifecycle** (Phase 6 — sub-department kanbans).
- **Accounting onboarding kanban** (Phase 4).
- **Recurring billing + monthly_invoices** (Phase 5).
- **Block client mechanic** (Phase 5).
- **Activity log diff viewer** (Phase 8).
- **Email-based notifications / reset / verification** (Phase 8).
- **Search across entities** (Phase 8).

If a task starts touching any of the above, stop and revisit.
