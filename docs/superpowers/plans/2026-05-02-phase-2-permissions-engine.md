# Phase 2 — Permissions Engine + Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 3-layer permissions engine (group_permissions + user_permissions overrides + field_permissions) plus admin UIs for configuring permissions, pipeline stages, and field-level rules. After this phase, every Phase 3+ feature can guard reads/writes via `current_user_can(board, action)` in RLS and `useEffectivePermission` in React.

**Architecture:** Three Postgres tables (`group_permissions`, `user_permissions`, `field_permissions`) feed a SQL function `current_user_can(board, action)` and a view `user_effective_permissions(user_id, board, action, allowed, scope)`. Field-level rules live in a separate table consumed by `useFieldPermission(table, field)` for UI hide/readonly behavior. A generic activity_log trigger captures changes to permission and stage tables. Admin UIs (4 new pages) configure all of this.

**Tech Stack:** Supabase Postgres functions + RLS + JSONB diffs in activity_log; React + TanStack Query for admin pages; @dnd-kit (already installed) optional for stage reordering — Phase 2 uses up/down buttons for simplicity; shadcn/ui for tables, dialogs, and form primitives.

**Reference spec:** `docs/superpowers/specs/2026-05-01-itdevcrm-design.md` — Sections 6.2 (pipeline_stages), 6.3 (Permissions 3 layers), 6.6 (activity_log), 7 (RLS pattern), 14 (Phase 2 plan).

**Builds on:** Phase 0 (foundations) + Phase 1 (auth + users + groups). Both shipped.

**Branch:** `main` (project pushes directly to main, no PRs — see memory/feedback_no_prs.md).

---

## File Structure (Phase 2 outcome)

```
.
├── supabase/
│   ├── migrations/
│   │   ├── 20260502000002_pipeline_stages.sql       # NEW
│   │   ├── 20260502000003_permissions_tables.sql    # NEW
│   │   ├── 20260502000004_activity_log.sql          # NEW
│   │   └── 20260502000005_permissions_engine.sql    # NEW (function + view)
│   └── tests/
│       └── permissions_engine.sql                   # NEW: SQL test cases
├── src/
│   ├── lib/
│   │   ├── permissions.ts                           # NEW: helpers (resolve, scope checks)
│   │   ├── permissions.test.ts                      # NEW
│   │   └── queryKeys.ts                             # MODIFY: add permissions/stages keys
│   ├── features/
│   │   ├── permissions/
│   │   │   ├── hooks/
│   │   │   │   ├── useEffectivePermission.ts        # NEW
│   │   │   │   ├── useEffectivePermission.test.tsx  # NEW
│   │   │   │   ├── useFieldPermission.ts            # NEW
│   │   │   │   ├── useFieldPermission.test.tsx      # NEW
│   │   │   │   ├── useUserEffectivePermissions.ts   # NEW: list of all perms for user
│   │   │   │   ├── useGroupPermissions.ts           # NEW
│   │   │   │   ├── useUpdateGroupPermission.ts      # NEW
│   │   │   │   ├── useUserPermissionOverrides.ts    # NEW
│   │   │   │   ├── useUpsertUserOverride.ts         # NEW
│   │   │   │   ├── useFieldPermissions.ts           # NEW: list field rules
│   │   │   │   └── useUpsertFieldRule.ts            # NEW
│   │   │   ├── GroupsListPage.tsx                   # NEW: /admin/groups
│   │   │   ├── GroupPermissionsPage.tsx             # NEW: /admin/groups/:id/permissions
│   │   │   ├── UserPermissionsPage.tsx              # NEW: /admin/users/:id/permissions
│   │   │   ├── FieldRulesPage.tsx                   # NEW: /admin/fields
│   │   │   └── PermissionsTestPage.tsx              # NEW: /admin/permissions/test (proves field rules work)
│   │   └── stages/
│   │       ├── hooks/
│   │       │   ├── usePipelineStages.ts             # NEW
│   │       │   ├── useUpsertStage.ts                # NEW
│   │       │   └── useReorderStage.ts               # NEW
│   │       └── StagesListPage.tsx                   # NEW: /admin/stages
│   ├── components/auth/
│   │   └── AdminGuard.tsx                           # (existing, unchanged)
│   ├── components/layout/
│   │   └── Sidebar.tsx                              # MODIFY: add admin links for groups/fields/stages
│   ├── app/
│   │   └── router.tsx                               # MODIFY: add 5 new admin routes
│   └── i18n/locales/
│       ├── en/admin.json                            # NEW
│       └── el/admin.json                            # NEW
└── tests/
    └── admin-permissions.spec.ts                    # NEW: e2e admin toggles permission
```

---

## Action and board catalogues (locked for Phase 2)

These constants are referenced across SQL seeds, TS validation, and the admin UI matrix.

**Boards** (matches `pipeline_stages.board` enum in 6.2):
- `sales`
- `accounting_onboarding`
- `accounting_recurring`  *(Phase 5; pre-seeded permission slots)*
- `web_seo`
- `local_seo`
- `web_dev`
- `social_media`
- `clients`             *(global "all clients" view; Phase 3+)*
- `users`               *(admin user management; Phase 1 baseline already enforces via is_admin)*
- `permissions`         *(meta board: who can edit permissions)*

**Actions** (one row per (group/user × board × action) in permission tables):
- `view`
- `create`
- `edit`
- `delete`
- `move_stage`
- `assign_owner`
- `comment`
- `attach_file`
- `lock_deal`              *(sales-specific)*
- `complete_accounting`    *(accounting_onboarding-specific)*
- `block_client`           *(accounting-specific)*
- `unblock_client`         *(accounting-specific)*
- `complete_job`           *(tech sub-departments)*
- `manage_permissions`     *(permissions board only — admin override)*

**Scopes:** `own`, `group`, `all`. Resolution order most-permissive: `all > group > own`.

---

## Conventions for every task

- Branch: `main`. Every task ends in a commit + push to `origin/main` (no PRs).
- Run `npm run format:check && npm run lint && npm run typecheck && npm run test:run` before each commit.
- Migration files are version-controlled and applied via `supabase db push` (pre-existing `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` env vars expected — see Phase 1 Task 1).
- After every migration, regenerate types: `npm run types:gen`.
- USER ACTION steps require human input — clearly marked.
- All UI strings go through `t(...)`.
- TDD where the logic warrants it (helpers, hooks).

---

## Task 1 — Migration: pipeline_stages + seeded stages

**Files:**
- Create: `supabase/migrations/20260502000002_pipeline_stages.sql`

- [ ] **Step 1: Create migration**

```sql
-- =============================================================================
-- Phase 2 migration: pipeline_stages (configurable kanban columns)
-- =============================================================================

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  board text not null,
  code text not null,
  display_names jsonb not null,        -- {"en": "...", "el": "..."}
  position int not null default 0,
  color text,                           -- hex; nullable
  is_terminal boolean not null default false,
  terminal_outcome text check (terminal_outcome in ('won', 'lost', 'paid', 'completed', 'cancelled')),
  triggers_action text check (triggers_action in ('lock_deal', 'complete_accounting')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board, code)
);

create index pipeline_stages_board on public.pipeline_stages (board) where archived = false;

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

-- RLS: any authenticated user can read; only admins mutate.
alter table public.pipeline_stages enable row level security;

create policy pipeline_stages_select_authenticated
  on public.pipeline_stages for select
  to authenticated
  using (archived = false or public.current_user_is_admin());

create policy pipeline_stages_mutate_admin
  on public.pipeline_stages for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- -----------------------------------------------------------------------------
-- Seeded stages (matches spec section 6.2)
-- -----------------------------------------------------------------------------
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
-- Sales board (10 stages, user-defined)
('sales', 'new_lead',       '{"en": "New Lead",       "el": "Νέος Πελάτης"}'::jsonb,        10, false, null, null),
('sales', 'no_answer',      '{"en": "No Answer",      "el": "Δεν Απαντά"}'::jsonb,           20, false, null, null),
('sales', 'constant_na',    '{"en": "Constant NA",    "el": "Σταθερά Δεν Απαντά"}'::jsonb,   30, false, null, null),
('sales', 'working_on_it',  '{"en": "Working On It",  "el": "Σε Εξέλιξη"}'::jsonb,           40, false, null, null),
('sales', 'offer_sent',     '{"en": "Offer Sent",     "el": "Προσφορά Στάλθηκε"}'::jsonb,    50, false, null, null),
('sales', 'scheduled',      '{"en": "Scheduled",      "el": "Προγραμματισμένο"}'::jsonb,     60, false, null, null),
('sales', 'hot',            '{"en": "Hot",            "el": "Καυτό"}'::jsonb,                70, false, null, null),
('sales', 'won',            '{"en": "Won",            "el": "Κερδισμένο"}'::jsonb,           80, true,  'won',     'lock_deal'),
('sales', 'not_interested', '{"en": "Not Interested", "el": "Μη Ενδιαφέρον"}'::jsonb,        90, true,  'lost',    null),
('sales', 'dead_end',       '{"en": "Dead End",       "el": "Αδιέξοδο"}'::jsonb,            100, true,  'lost',    null),

-- Accounting onboarding board
('accounting_onboarding', 'new',                '{"en": "New",                "el": "Νέο"}'::jsonb,                  10, false, null, null),
('accounting_onboarding', 'documents_verified', '{"en": "Documents Verified", "el": "Έγγραφα Επιβεβαιωμένα"}'::jsonb, 20, false, null, null),
('accounting_onboarding', 'invoice_issued',     '{"en": "Invoice Issued",     "el": "Τιμολόγιο Εκδόθηκε"}'::jsonb,    30, false, null, null),
('accounting_onboarding', 'awaiting_payment',   '{"en": "Awaiting Payment",   "el": "Αναμονή Πληρωμής"}'::jsonb,      40, false, null, null),
('accounting_onboarding', 'partial_payment',    '{"en": "Partial Payment",    "el": "Μερική Πληρωμή"}'::jsonb,        50, false, null, null),
('accounting_onboarding', 'paid_in_full',       '{"en": "Paid In Full",       "el": "Πλήρως Εξοφλημένο"}'::jsonb,     60, true,  'paid',      'complete_accounting'),
('accounting_onboarding', 'on_hold',            '{"en": "On Hold",            "el": "Σε Αναμονή"}'::jsonb,           70, false, null, null),
('accounting_onboarding', 'refunded',           '{"en": "Refunded",           "el": "Επιστροφή Χρημάτων"}'::jsonb,    80, true,  'cancelled', null),

-- Web SEO (recurring)
('web_seo', 'onboarding',     '{"en": "Onboarding",     "el": "Ενσωμάτωση"}'::jsonb,         10, false, null, null),
('web_seo', 'audit_strategy', '{"en": "Audit & Strategy","el": "Έλεγχος & Στρατηγική"}'::jsonb, 20, false, null, null),
('web_seo', 'active',         '{"en": "Active",         "el": "Ενεργό"}'::jsonb,             30, false, null, null),
('web_seo', 'on_hold',        '{"en": "On Hold",        "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
('web_seo', 'cancelled',      '{"en": "Cancelled",      "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null),

-- Local SEO (recurring)
('local_seo', 'onboarding',    '{"en": "Onboarding",    "el": "Ενσωμάτωση"}'::jsonb,        10, false, null, null),
('local_seo', 'gbp_setup',     '{"en": "GBP Setup",     "el": "Ρύθμιση Google Business"}'::jsonb, 20, false, null, null),
('local_seo', 'active',        '{"en": "Active",        "el": "Ενεργό"}'::jsonb,             30, false, null, null),
('local_seo', 'on_hold',       '{"en": "On Hold",       "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
('local_seo', 'cancelled',     '{"en": "Cancelled",     "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null),

-- Social Media (recurring)
('social_media', 'onboarding',         '{"en": "Onboarding",         "el": "Ενσωμάτωση"}'::jsonb,        10, false, null, null),
('social_media', 'content_plan',       '{"en": "Content Plan",       "el": "Πλάνο Περιεχομένου"}'::jsonb, 20, false, null, null),
('social_media', 'active',             '{"en": "Active",             "el": "Ενεργό"}'::jsonb,             30, false, null, null),
('social_media', 'on_hold',            '{"en": "On Hold",            "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
('social_media', 'cancelled',          '{"en": "Cancelled",          "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null),

-- Web Dev (one-time)
('web_dev', 'awaiting_brief', '{"en": "Awaiting Brief", "el": "Αναμονή Brief"}'::jsonb,        10, false, null, null),
('web_dev', 'discovery',      '{"en": "Discovery",      "el": "Ανακάλυψη"}'::jsonb,             20, false, null, null),
('web_dev', 'wireframes',     '{"en": "Wireframes",     "el": "Wireframes"}'::jsonb,             30, false, null, null),
('web_dev', 'design',         '{"en": "Design",         "el": "Σχεδιασμός"}'::jsonb,            40, false, null, null),
('web_dev', 'development',    '{"en": "Development",    "el": "Ανάπτυξη"}'::jsonb,              50, false, null, null),
('web_dev', 'internal_qa',    '{"en": "Internal QA",    "el": "Εσωτερικός Έλεγχος"}'::jsonb,    60, false, null, null),
('web_dev', 'client_review',  '{"en": "Client Review",  "el": "Έλεγχος Πελάτη"}'::jsonb,        70, false, null, null),
('web_dev', 'revisions',      '{"en": "Revisions",      "el": "Διορθώσεις"}'::jsonb,            80, false, null, null),
('web_dev', 'live',           '{"en": "Live",           "el": "Παραδόθηκε"}'::jsonb,            90, true,  'completed', null),
('web_dev', 'maintenance',    '{"en": "Maintenance",    "el": "Συντήρηση"}'::jsonb,            100, true,  'completed', null);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000002_pipeline_stages.sql
git commit -m "feat(db): pipeline_stages table + seed 50+ stages for 6 boards"
git push
```

---

## Task 2 — Migration: permissions tables (group/user/field)

**Files:**
- Create: `supabase/migrations/20260502000003_permissions_tables.sql`

- [ ] **Step 1: Create migration**

```sql
-- =============================================================================
-- Phase 2 migration: group_permissions, user_permissions, field_permissions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. group_permissions  (Layer 1: per-group default)
-- -----------------------------------------------------------------------------
create table public.group_permissions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  board text not null,
  action text not null,
  scope text not null check (scope in ('own', 'group', 'all')),
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, board, action)
);

create index group_permissions_group on public.group_permissions (group_id);
create index group_permissions_board_action on public.group_permissions (board, action);

create trigger group_permissions_set_updated_at
  before update on public.group_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. user_permissions  (Layer 2: per-user override)
-- -----------------------------------------------------------------------------
create table public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  board text not null,
  action text not null,
  scope text not null check (scope in ('own', 'group', 'all')),
  allowed boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, board, action)
);

create index user_permissions_user on public.user_permissions (user_id);

create trigger user_permissions_set_updated_at
  before update on public.user_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. field_permissions  (Layer 3: hidden / readonly per field)
-- -----------------------------------------------------------------------------
create table public.field_permissions (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('group', 'user')),
  scope_id uuid not null,
  table_name text not null,
  field_name text not null,
  mode text not null check (mode in ('hidden', 'readonly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id, table_name, field_name)
);

create index field_permissions_lookup on public.field_permissions (scope_type, scope_id);
create index field_permissions_table on public.field_permissions (table_name);

create trigger field_permissions_set_updated_at
  before update on public.field_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — all three tables: admins only
-- -----------------------------------------------------------------------------
alter table public.group_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.field_permissions enable row level security;

create policy group_permissions_select_authenticated
  on public.group_permissions for select
  to authenticated
  using (true);

create policy group_permissions_mutate_admin
  on public.group_permissions for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy user_permissions_select_self_or_admin
  on public.user_permissions for select
  to authenticated
  using (auth.uid() = user_id or public.current_user_is_admin());

create policy user_permissions_mutate_admin
  on public.user_permissions for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy field_permissions_select_authenticated
  on public.field_permissions for select
  to authenticated
  using (true);

create policy field_permissions_mutate_admin
  on public.field_permissions for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000003_permissions_tables.sql
git commit -m "feat(db): permissions tables (group/user/field) + RLS"
git push
```

---

## Task 3 — Migration: activity_log + generic trigger

**Files:**
- Create: `supabase/migrations/20260502000004_activity_log.sql`

- [ ] **Step 1: Create migration**

```sql
-- =============================================================================
-- Phase 2 migration: activity_log + generic trigger
-- =============================================================================

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid references public.profiles(user_id),
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_entity on public.activity_log (entity_type, entity_id);
create index activity_log_created_at on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

create policy activity_log_select_admin
  on public.activity_log for select
  to authenticated
  using (public.current_user_is_admin());

-- INSERTs only via the trigger (security definer); no client INSERT policy.

-- -----------------------------------------------------------------------------
-- Generic trigger function
-- -----------------------------------------------------------------------------
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  entity_id_value uuid;
  changes_json jsonb;
begin
  -- Pick the entity id from the row's primary key column.
  -- Convention: each tracked table has an `id` column or we set TG_ARGV[0] to the column name.
  if tg_op = 'DELETE' then
    entity_id_value := (row_to_json(old)::jsonb ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := row_to_json(old)::jsonb;
  elsif tg_op = 'INSERT' then
    entity_id_value := (row_to_json(new)::jsonb ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := row_to_json(new)::jsonb;
  else
    entity_id_value := (row_to_json(new)::jsonb ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := jsonb_build_object('old', row_to_json(old)::jsonb, 'new', row_to_json(new)::jsonb);
  end if;

  insert into public.activity_log (entity_type, entity_id, user_id, action, changes)
  values (tg_table_name, entity_id_value, auth.uid(), lower(tg_op), changes_json);

  return coalesce(new, old);
end $$;

-- -----------------------------------------------------------------------------
-- Apply trigger to permission + stage tables (Phase 3 will extend to clients/deals/jobs)
-- -----------------------------------------------------------------------------
create trigger group_permissions_activity
  after insert or update or delete on public.group_permissions
  for each row execute function public.log_activity('id');

create trigger user_permissions_activity
  after insert or update or delete on public.user_permissions
  for each row execute function public.log_activity('id');

create trigger field_permissions_activity
  after insert or update or delete on public.field_permissions
  for each row execute function public.log_activity('id');

create trigger pipeline_stages_activity
  after insert or update or delete on public.pipeline_stages
  for each row execute function public.log_activity('id');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000004_activity_log.sql
git commit -m "feat(db): activity_log + generic trigger applied to permission tables"
git push
```

---

## Task 4 — Migration: permissions engine (function + view)

**Files:**
- Create: `supabase/migrations/20260502000005_permissions_engine.sql`

- [ ] **Step 1: Create migration**

```sql
-- =============================================================================
-- Phase 2 migration: permissions engine - current_user_can() + view
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_effective_permissions view
-- For each (user, board, action), return the most-permissive scope across:
--   1. their group permissions (any group they belong to)
--   2. their user-level overrides (one row per (user, board, action))
-- User overrides take precedence over group defaults.
-- Scope precedence: 'all' > 'group' > 'own'.
-- -----------------------------------------------------------------------------
create or replace view public.user_effective_permissions as
with all_group_perms as (
  -- One row per (user, board, action) representing the most-permissive group grant.
  select
    ug.user_id,
    gp.board,
    gp.action,
    bool_or(gp.allowed) as group_any_allowed,
    -- Most-permissive scope (custom ranking)
    max(case gp.scope when 'all' then 3 when 'group' then 2 when 'own' then 1 end)
      filter (where gp.allowed) as group_scope_rank
  from public.user_groups ug
  join public.group_permissions gp on gp.group_id = ug.group_id
  group by ug.user_id, gp.board, gp.action
),
combined as (
  select
    coalesce(up.user_id, agp.user_id) as user_id,
    coalesce(up.board, agp.board) as board,
    coalesce(up.action, agp.action) as action,
    case when up.user_id is not null then up.allowed else coalesce(agp.group_any_allowed, false) end as allowed,
    case
      when up.user_id is not null then up.scope
      when agp.group_scope_rank = 3 then 'all'
      when agp.group_scope_rank = 2 then 'group'
      when agp.group_scope_rank = 1 then 'own'
      else null
    end as scope
  from all_group_perms agp
  full outer join public.user_permissions up
    on up.user_id = agp.user_id
   and up.board = agp.board
   and up.action = agp.action
)
select user_id, board, action, allowed, scope from combined
where allowed = true;

-- View runs as the caller, so RLS on underlying tables (user_permissions, group_permissions, user_groups)
-- determines what the caller sees. The permissions tables allow SELECT to authenticated users; the user_groups
-- table allows self+admin.

-- -----------------------------------------------------------------------------
-- current_user_can(board, action) — returns true if caller is admin OR has an effective grant.
-- -----------------------------------------------------------------------------
create or replace function public.current_user_can(target_board text, target_action text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.current_user_is_admin() or exists (
      select 1
      from public.user_effective_permissions
      where user_id = auth.uid()
        and board = target_board
        and action = target_action
        and allowed = true
    );
$$;

-- -----------------------------------------------------------------------------
-- current_user_scope(board, action) — returns 'all' | 'group' | 'own' | null
-- Used by RLS policies that need to know the scope (not just allowed).
-- -----------------------------------------------------------------------------
create or replace function public.current_user_scope(target_board text, target_action text)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_is_admin() then 'all'
    else (
      select scope
      from public.user_effective_permissions
      where user_id = auth.uid()
        and board = target_board
        and action = target_action
        and allowed = true
      order by case scope when 'all' then 3 when 'group' then 2 when 'own' then 1 end desc
      limit 1
    )
  end;
$$;

grant select on public.user_effective_permissions to authenticated;
grant execute on function public.current_user_can(text, text) to authenticated;
grant execute on function public.current_user_scope(text, text) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000005_permissions_engine.sql
git commit -m "feat(db): permissions engine - user_effective_permissions view + current_user_can()"
git push
```

---

## Task 5 — Apply migrations + regenerate types

**Files:** none modified by hand

- [ ] **Step 1: Push migrations to remote**

```bash
# Assumes SUPABASE_ACCESS_TOKEN already in env (see Phase 1 Task 1)
# Assumes SUPABASE_DB_PASSWORD already in env
echo y | npx -y supabase@latest db push 2>&1 | tail -10
```

Expected: 4 new migrations applied. If there are errors, paste them and stop.

- [ ] **Step 2: Smoke-verify via REST**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')

# Stage count
echo "Stages count:"
curl -sS "${URL}/rest/v1/pipeline_stages?select=count" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -H 'Prefer: count=exact' -D - -o /dev/null 2>&1 | grep -i 'content-range'

# Permission tables exist
for t in group_permissions user_permissions field_permissions activity_log; do
  echo -n "$t: "
  curl -sS -o /dev/null -w 'HTTP %{http_code}\n' "${URL}/rest/v1/${t}?select=*&limit=1" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
done
```

Expected: stages count 50+, all 4 permission tables HTTP 200.

- [ ] **Step 3: Regenerate types**

```bash
npm run types:gen
npm run typecheck
```

`typecheck` must exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/types/supabase.ts
git commit -m "feat(types): regenerate after permissions migrations"
git push
```

---

## Task 6 — TS helpers: lib/permissions.ts + tests

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `src/lib/permissions.test.ts`
- Modify: `src/lib/queryKeys.ts` — add permissions/stages keys

- [ ] **Step 1: Extend queryKeys**

Read current `src/lib/queryKeys.ts`. Append:

```ts
export const queryKeys = {
  groups: () => ['groups'] as const,
  users: () => ['users'] as const,
  user: (id: string) => ['user', id] as const,
  profile: (id: string) => ['profile', id] as const,
  userGroups: (userId: string) => ['user-groups', userId] as const,
  // Phase 2:
  pipelineStages: () => ['pipeline-stages'] as const,
  groupPermissions: (groupId: string) => ['group-permissions', groupId] as const,
  userOverrides: (userId: string) => ['user-overrides', userId] as const,
  effectivePermissions: (userId: string) => ['effective-permissions', userId] as const,
  fieldPermissions: () => ['field-permissions'] as const,
};
```

- [ ] **Step 2: Action + scope catalogue**

Path: `src/lib/permissions.ts`

```ts
import { supabase } from '@/lib/supabase';

export const ALL_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'move_stage',
  'assign_owner',
  'comment',
  'attach_file',
  'lock_deal',
  'complete_accounting',
  'block_client',
  'unblock_client',
  'complete_job',
  'manage_permissions',
] as const;

export type Action = (typeof ALL_ACTIONS)[number];

export const ALL_BOARDS = [
  'sales',
  'accounting_onboarding',
  'accounting_recurring',
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'clients',
  'users',
  'permissions',
] as const;

export type Board = (typeof ALL_BOARDS)[number];

export const ALL_SCOPES = ['own', 'group', 'all'] as const;
export type Scope = (typeof ALL_SCOPES)[number];

const SCOPE_RANK: Record<Scope, number> = { own: 1, group: 2, all: 3 };

export function maxScope(a: Scope | null, b: Scope | null): Scope | null {
  if (a == null) return b;
  if (b == null) return a;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** Server-authoritative check: returns true iff caller has the action on the board. */
export async function currentUserCan(board: Board, action: Action): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_can', {
    target_board: board,
    target_action: action,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function currentUserScope(board: Board, action: Action): Promise<Scope | null> {
  const { data, error } = await supabase.rpc('current_user_scope', {
    target_board: board,
    target_action: action,
  });
  if (error) throw new Error(error.message);
  return (data ?? null) as Scope | null;
}
```

- [ ] **Step 3: Tests**

Path: `src/lib/permissions.test.ts`

```ts
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { currentUserCan, currentUserScope, maxScope } from './permissions';

describe('permission helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maxScope returns the more permissive scope', () => {
    expect(maxScope('own', 'group')).toBe('group');
    expect(maxScope('group', 'all')).toBe('all');
    expect(maxScope(null, 'own')).toBe('own');
    expect(maxScope('all', null)).toBe('all');
    expect(maxScope(null, null)).toBeNull();
  });

  it('currentUserCan calls the RPC with correct args', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const ok = await currentUserCan('sales', 'edit');
    expect(rpc).toHaveBeenCalledWith('current_user_can', {
      target_board: 'sales',
      target_action: 'edit',
    });
    expect(ok).toBe(true);
  });

  it('currentUserCan throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(currentUserCan('sales', 'edit')).rejects.toThrow('boom');
  });

  it('currentUserScope returns the scope or null', async () => {
    rpc.mockResolvedValue({ data: 'all', error: null });
    expect(await currentUserScope('sales', 'view')).toBe('all');
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await currentUserScope('sales', 'view')).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- permissions
```

Expected: 4/4 pass.

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/lib/permissions.ts src/lib/permissions.test.ts src/lib/queryKeys.ts
git commit -m "feat(permissions): TS helpers + queryKeys for permissions"
git push
```

---

## Task 7 — Hook: useEffectivePermission + tests

**Files:**
- Create: `src/features/permissions/hooks/useEffectivePermission.ts`
- Create: `src/features/permissions/hooks/useEffectivePermission.test.tsx`

- [ ] **Step 1: Hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/authStore';
import { currentUserCan, currentUserScope, type Action, type Board, type Scope } from '@/lib/permissions';
import { queryKeys } from '@/lib/queryKeys';

type PermissionResult = { allowed: boolean; scope: Scope | null; isLoading: boolean };

export function useEffectivePermission(board: Board, action: Action): PermissionResult {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const allowedQuery = useQuery({
    queryKey: ['can', userId, board, action] as const,
    queryFn: () => currentUserCan(board, action),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const scopeQuery = useQuery({
    queryKey: ['scope', userId, board, action] as const,
    queryFn: () => currentUserScope(board, action),
    enabled: !!userId && allowedQuery.data === true,
    staleTime: 60_000,
  });

  return {
    allowed: allowedQuery.data === true,
    scope: scopeQuery.data ?? null,
    isLoading: allowedQuery.isLoading || (allowedQuery.data === true && scopeQuery.isLoading),
  };
}
```

- [ ] **Step 2: Tests**

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { useAuthStore } from '@/lib/stores/authStore';
import { useEffectivePermission } from './useEffectivePermission';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useEffectivePermission', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useAuthStore.getState().setSession({ access_token: 't' } as never, { id: 'u1', email: 'a@b' } as never);
    vi.clearAllMocks();
  });

  it('returns allowed=false when not granted', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { result } = renderHook(() => useEffectivePermission('sales', 'edit'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.scope).toBeNull();
  });

  it('returns allowed=true + scope when granted', async () => {
    rpc.mockImplementation((fn) =>
      Promise.resolve(
        fn === 'current_user_can'
          ? { data: true, error: null }
          : { data: 'group', error: null },
      ),
    );
    const { result } = renderHook(() => useEffectivePermission('sales', 'edit'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => {
      expect(result.current.allowed).toBe(true);
      expect(result.current.scope).toBe('group');
    });
  });
});
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/permissions/
git commit -m "feat(permissions): useEffectivePermission hook + tests"
git push
```

---

## Task 8 — Hook: useFieldPermission + tests

**Files:**
- Create: `src/features/permissions/hooks/useFieldPermission.ts`
- Create: `src/features/permissions/hooks/useFieldPermission.test.tsx`
- Create: `src/features/permissions/hooks/useFieldPermissionsAll.ts` (cached map for the user)

- [ ] **Step 1: Cached "all field rules for current user" hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

export type FieldMode = 'hidden' | 'readonly';

type Row = {
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: FieldMode;
};

export function useFieldPermissionsAll() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const groupCodes = useAuthStore((s) => s.groupCodes);

  return useQuery({
    queryKey: [...queryKeys.fieldPermissions(), userId, groupCodes.join(',')] as const,
    queryFn: async () => {
      // Fetch rules: those keyed to this user OR keyed to groups they belong to.
      const { data: groupRows } = await supabase
        .from('groups')
        .select('id')
        .in('code', groupCodes.length > 0 ? groupCodes : ['__none__']);
      const groupIds = (groupRows ?? []).map((g) => g.id);
      const { data, error } = await supabase
        .from('field_permissions')
        .select('scope_type, scope_id, table_name, field_name, mode');
      if (error) throw new Error(error.message);
      const userRules = (data as unknown as Row[]).filter(
        (r) =>
          (r.scope_type === 'user' && r.scope_id === userId) ||
          (r.scope_type === 'group' && groupIds.includes(r.scope_id)),
      );
      return userRules;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Per-field hook**

```ts
import { useFieldPermissionsAll, type FieldMode } from './useFieldPermissionsAll';

export type FieldPermission = 'editable' | 'readonly' | 'hidden';

const SEVERITY: Record<FieldMode, number> = { readonly: 1, hidden: 2 };

export function useFieldPermission(table: string, field: string): FieldPermission {
  const { data: rules = [] } = useFieldPermissionsAll();

  // user-scope rules win over group-scope rules.
  const matches = rules.filter((r) => r.table_name === table && r.field_name === field);
  if (matches.length === 0) return 'editable';

  const userMatch = matches.find((m) => m.scope_type === 'user');
  if (userMatch) return userMatch.mode === 'hidden' ? 'hidden' : 'readonly';

  // Among group rules, take most-restrictive (hidden > readonly).
  const groupMode = matches.reduce<FieldMode>((acc, m) => {
    return SEVERITY[m.mode] > SEVERITY[acc] ? m.mode : acc;
  }, 'readonly');
  return groupMode === 'hidden' ? 'hidden' : 'readonly';
}
```

- [ ] **Step 3: Tests**

```tsx
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./useFieldPermissionsAll', () => ({
  useFieldPermissionsAll: vi.fn(),
}));

import { useFieldPermissionsAll } from './useFieldPermissionsAll';
import { useFieldPermission } from './useFieldPermission';

function wrap(c: ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useFieldPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns editable when no rules apply', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('editable');
  });

  it('returns hidden when a user-scope rule is hidden', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{ scope_type: 'user', scope_id: 'u', table_name: 'clients', field_name: 'phone', mode: 'hidden' }],
    });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('hidden');
  });

  it('user rule wins over group rule', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { scope_type: 'group', scope_id: 'g', table_name: 'clients', field_name: 'phone', mode: 'hidden' },
        { scope_type: 'user',  scope_id: 'u', table_name: 'clients', field_name: 'phone', mode: 'readonly' },
      ],
    });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('readonly');
  });

  it('most-restrictive wins among group rules', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { scope_type: 'group', scope_id: 'g1', table_name: 'clients', field_name: 'phone', mode: 'readonly' },
        { scope_type: 'group', scope_id: 'g2', table_name: 'clients', field_name: 'phone', mode: 'hidden' },
      ],
    });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('hidden');
  });
});
```

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/permissions/
git commit -m "feat(permissions): useFieldPermission + useFieldPermissionsAll hooks"
git push
```

---

## Task 9 — i18n: admin namespace EN + EL

**Files:**
- Create: `src/i18n/locales/en/admin.json`
- Create: `src/i18n/locales/el/admin.json`
- Modify: `src/lib/i18n.ts` — register `admin` namespace

- [ ] **Step 1: Translations**

`src/i18n/locales/en/admin.json`:

```json
{
  "nav": {
    "groups": "Groups & permissions",
    "fields": "Field rules",
    "stages": "Pipeline stages",
    "permissions_test": "Permissions test page"
  },
  "groups": {
    "title": "Groups",
    "manage": "Manage permissions",
    "members": "members"
  },
  "permissions": {
    "title": "Permissions for {{group}}",
    "user_title": "Permissions for {{user}}",
    "boards": {
      "sales": "Sales",
      "accounting_onboarding": "Accounting onboarding",
      "accounting_recurring": "Accounting recurring",
      "web_seo": "Web SEO",
      "local_seo": "Local SEO",
      "web_dev": "Web Dev",
      "social_media": "Social Media",
      "clients": "Clients",
      "users": "Users",
      "permissions": "Permissions"
    },
    "actions": {
      "view": "View",
      "create": "Create",
      "edit": "Edit",
      "delete": "Delete",
      "move_stage": "Move stage",
      "assign_owner": "Assign owner",
      "comment": "Comment",
      "attach_file": "Attach file",
      "lock_deal": "Lock deal",
      "complete_accounting": "Complete accounting",
      "block_client": "Block client",
      "unblock_client": "Unblock client",
      "complete_job": "Complete job",
      "manage_permissions": "Manage permissions"
    },
    "scopes": {
      "own": "Own",
      "group": "Group",
      "all": "All",
      "denied": "—"
    },
    "from_groups": "From groups",
    "override": "Override",
    "remove_override": "Remove override"
  },
  "fields": {
    "title": "Field-level rules",
    "table": "Table",
    "field": "Field",
    "scope_type": "Applies to",
    "scope_value": "Group / User",
    "mode": "Mode",
    "modes": {
      "hidden": "Hidden",
      "readonly": "Read-only"
    },
    "add": "Add rule",
    "delete": "Delete"
  },
  "stages": {
    "title": "Pipeline stages",
    "board": "Board",
    "code": "Code",
    "name_en": "Name (EN)",
    "name_el": "Name (EL)",
    "position": "Position",
    "color": "Color",
    "is_terminal": "Terminal",
    "terminal_outcome": "Outcome",
    "triggers_action": "Triggers",
    "add": "Add stage",
    "save": "Save",
    "move_up": "Move up",
    "move_down": "Move down",
    "archive": "Archive"
  },
  "test_page": {
    "title": "Permissions test page",
    "description": "Use this page to verify that field-level rules hide / lock fields for your user.",
    "demo_field": "Demo field",
    "evaluation": "Evaluated mode: {{mode}}"
  }
}
```

`src/i18n/locales/el/admin.json`:

```json
{
  "nav": {
    "groups": "Ομάδες & δικαιώματα",
    "fields": "Κανόνες πεδίων",
    "stages": "Στάδια Pipeline",
    "permissions_test": "Δοκιμή δικαιωμάτων"
  },
  "groups": {
    "title": "Ομάδες",
    "manage": "Διαχείριση δικαιωμάτων",
    "members": "μέλη"
  },
  "permissions": {
    "title": "Δικαιώματα για {{group}}",
    "user_title": "Δικαιώματα για {{user}}",
    "boards": {
      "sales": "Πωλήσεις",
      "accounting_onboarding": "Λογιστήριο - Νέοι",
      "accounting_recurring": "Λογιστήριο - Επαναλαμβανόμενα",
      "web_seo": "Web SEO",
      "local_seo": "Τοπικό SEO",
      "web_dev": "Ανάπτυξη Ιστού",
      "social_media": "Social Media",
      "clients": "Πελάτες",
      "users": "Χρήστες",
      "permissions": "Δικαιώματα"
    },
    "actions": {
      "view": "Προβολή",
      "create": "Δημιουργία",
      "edit": "Επεξεργασία",
      "delete": "Διαγραφή",
      "move_stage": "Μετακίνηση σταδίου",
      "assign_owner": "Ανάθεση",
      "comment": "Σχόλιο",
      "attach_file": "Επισύναψη",
      "lock_deal": "Κλείδωμα συμφωνίας",
      "complete_accounting": "Ολοκλήρωση Λογιστηρίου",
      "block_client": "Μπλοκ πελάτη",
      "unblock_client": "Ξεμπλοκ πελάτη",
      "complete_job": "Ολοκλήρωση εργασίας",
      "manage_permissions": "Διαχείριση δικαιωμάτων"
    },
    "scopes": {
      "own": "Δικά μου",
      "group": "Ομάδα",
      "all": "Όλα",
      "denied": "—"
    },
    "from_groups": "Από ομάδες",
    "override": "Παρέκκλιση",
    "remove_override": "Αφαίρεση παρέκκλισης"
  },
  "fields": {
    "title": "Κανόνες ανά πεδίο",
    "table": "Πίνακας",
    "field": "Πεδίο",
    "scope_type": "Εφαρμόζεται σε",
    "scope_value": "Ομάδα / Χρήστης",
    "mode": "Τρόπος",
    "modes": {
      "hidden": "Κρυφό",
      "readonly": "Μόνο ανάγνωση"
    },
    "add": "Προσθήκη κανόνα",
    "delete": "Διαγραφή"
  },
  "stages": {
    "title": "Στάδια Pipeline",
    "board": "Board",
    "code": "Κωδικός",
    "name_en": "Όνομα (EN)",
    "name_el": "Όνομα (EL)",
    "position": "Θέση",
    "color": "Χρώμα",
    "is_terminal": "Τερματικό",
    "terminal_outcome": "Έκβαση",
    "triggers_action": "Ενεργοποιεί",
    "add": "Προσθήκη σταδίου",
    "save": "Αποθήκευση",
    "move_up": "Πάνω",
    "move_down": "Κάτω",
    "archive": "Αρχειοθέτηση"
  },
  "test_page": {
    "title": "Δοκιμή δικαιωμάτων",
    "description": "Χρησιμοποιήστε αυτή τη σελίδα για να επιβεβαιώσετε ότι οι κανόνες πεδίων κρύβουν / κλειδώνουν πεδία για τον χρήστη σας.",
    "demo_field": "Demo πεδίο",
    "evaluation": "Αξιολογημένος τρόπος: {{mode}}"
  }
}
```

- [ ] **Step 2: Register namespace**

Read `src/lib/i18n.ts`. Add imports + extend ns/resources:

```ts
import enAdmin from '@/i18n/locales/en/admin.json';
import elAdmin from '@/i18n/locales/el/admin.json';
// ...
ns: ['common', 'auth', 'users', 'admin'],
resources: {
  en: { common: enCommon, auth: enAuth, users: enUsers, admin: enAdmin },
  el: { common: elCommon, auth: elAuth, users: elUsers, admin: elAdmin },
},
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(i18n): admin namespace EN + EL"
git push
```

---

## Task 10 — `/admin/groups` list page

**Files:**
- Create: `src/features/permissions/hooks/useGroupsWithCounts.ts`
- Create: `src/features/permissions/GroupsListPage.tsx`
- Modify: `src/app/router.tsx` — add `/admin/groups` route
- Modify: `src/components/layout/Sidebar.tsx` — add admin links

- [ ] **Step 1: Hook with member counts**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type GroupWithCount = {
  id: string;
  code: string;
  display_names: { en: string; el: string };
  parent_label: string | null;
  position: number;
  member_count: number;
};

export function useGroupsWithCounts() {
  return useQuery({
    queryKey: [...queryKeys.groups(), 'with-counts'] as const,
    queryFn: async (): Promise<GroupWithCount[]> => {
      const { data: groups, error: e1 } = await supabase
        .from('groups')
        .select('id, code, display_names, parent_label, position')
        .eq('archived', false)
        .order('position');
      if (e1) throw new Error(e1.message);
      const { data: counts, error: e2 } = await supabase
        .from('user_groups')
        .select('group_id');
      if (e2) throw new Error(e2.message);
      const tally = new Map<string, number>();
      (counts ?? []).forEach((r) => tally.set(r.group_id, (tally.get(r.group_id) ?? 0) + 1));
      return (groups ?? []).map((g) => ({
        ...(g as unknown as Omit<GroupWithCount, 'member_count'>),
        member_count: tally.get(g.id) ?? 0,
      }));
    },
  });
}
```

- [ ] **Step 2: Page**

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useGroupsWithCounts } from './hooks/useGroupsWithCounts';

export function GroupsListPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [], isLoading, error } = useGroupsWithCounts();

  if (isLoading) return <div className="p-8">…</div>;
  if (error) return <div className="p-8 text-red-600">{error.message}</div>;

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">{t('groups.title')}</h1>
      <ul className="divide-y rounded-md border">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium">{g.display_names[lang]}</div>
              <div className="text-sm text-muted-foreground">
                {g.member_count} {t('groups.members')} · {g.parent_label}
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={`/admin/groups/${g.id}/permissions`}>{t('groups.manage')}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add route**

Edit `src/app/router.tsx`. Inside the `admin` route children, add:

```tsx
import { GroupsListPage } from '@/features/permissions/GroupsListPage';
// ...inside the admin children array:
{ path: 'groups', element: <GroupsListPage /> },
```

- [ ] **Step 4: Sidebar**

Edit `src/components/layout/Sidebar.tsx` — when `isAdmin`, add a link. Keep existing structure; add after the Users link:

```tsx
<NavLink
  to="/admin/groups"
  className={({ isActive }) =>
    `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
  }
>
  {t('admin:nav.groups')}
</NavLink>
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): /admin/groups list page + sidebar link"
git push
```

---

## Task 11 — `/admin/groups/:groupId/permissions` matrix UI

**Files:**
- Create: `src/features/permissions/hooks/useGroupPermissions.ts`
- Create: `src/features/permissions/hooks/useUpsertGroupPermission.ts`
- Create: `src/features/permissions/GroupPermissionsPage.tsx`
- Modify: `src/app/router.tsx` — add the route

- [ ] **Step 1: Query hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

export type GroupPermissionRow = {
  id: string;
  group_id: string;
  board: Board;
  action: Action;
  scope: Scope;
  allowed: boolean;
};

export function useGroupPermissions(groupId: string) {
  return useQuery({
    queryKey: queryKeys.groupPermissions(groupId),
    queryFn: async (): Promise<GroupPermissionRow[]> => {
      const { data, error } = await supabase
        .from('group_permissions')
        .select('id, group_id, board, action, scope, allowed')
        .eq('group_id', groupId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as GroupPermissionRow[];
    },
    enabled: !!groupId,
  });
}
```

- [ ] **Step 2: Mutation hook**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

type Vars = {
  groupId: string;
  board: Board;
  action: Action;
  allowed: boolean;
  scope: Scope;
};

export function useUpsertGroupPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, board, action, allowed, scope }: Vars) => {
      const { error } = await supabase
        .from('group_permissions')
        .upsert(
          { group_id: groupId, board, action, allowed, scope },
          { onConflict: 'group_id,board,action' },
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groupPermissions(vars.groupId) });
    },
  });
}
```

- [ ] **Step 3: Matrix page**

```tsx
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ALL_ACTIONS, ALL_BOARDS, ALL_SCOPES, type Action, type Board, type Scope } from '@/lib/permissions';
import { useGroupPermissions } from './hooks/useGroupPermissions';
import { useUpsertGroupPermission } from './hooks/useUpsertGroupPermission';
import { useGroups } from '@/features/groups/hooks/useGroups';

export function GroupPermissionsPage() {
  const { groupId = '' } = useParams<{ groupId: string }>();
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const { data: rows = [], isLoading } = useGroupPermissions(groupId);
  const upsert = useUpsertGroupPermission();

  if (!group) return <div className="p-8">…</div>;
  if (isLoading) return <div className="p-8">…</div>;

  const map = new Map<string, { allowed: boolean; scope: Scope }>();
  for (const r of rows) map.set(`${r.board}:${r.action}`, { allowed: r.allowed, scope: r.scope });

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">
        {t('permissions.title', { group: group.display_names[lang] })}
      </h1>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left">
            <th className="py-2 px-3">{/* Board × Action */}</th>
            {ALL_ACTIONS.map((a) => (
              <th key={a} className="py-2 px-3 align-bottom">
                <div className="rotate-180 text-xs [writing-mode:vertical-rl]">
                  {t(`permissions.actions.${a}`)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_BOARDS.map((b) => (
            <tr key={b} className="border-b">
              <th className="py-2 px-3 text-left font-medium">
                {t(`permissions.boards.${b}`)}
              </th>
              {ALL_ACTIONS.map((a) => {
                const cell = map.get(`${b}:${a}`);
                const allowed = cell?.allowed ?? false;
                const scope = cell?.scope ?? 'own';
                return (
                  <td key={a} className="py-2 px-3 align-middle">
                    <div className="flex flex-col items-center gap-1">
                      <Checkbox
                        checked={allowed}
                        onCheckedChange={(v) => {
                          void upsert.mutateAsync({
                            groupId,
                            board: b as Board,
                            action: a as Action,
                            allowed: v === true,
                            scope,
                          });
                        }}
                      />
                      {allowed && (
                        <Select
                          value={scope}
                          onValueChange={(s) => {
                            void upsert.mutateAsync({
                              groupId,
                              board: b as Board,
                              action: a as Action,
                              allowed: true,
                              scope: s as Scope,
                            });
                          }}
                        >
                          <SelectTrigger className="h-7 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_SCOPES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {t(`permissions.scopes.${s}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Add route**

```tsx
import { GroupPermissionsPage } from '@/features/permissions/GroupPermissionsPage';
// ...inside the admin children:
{ path: 'groups/:groupId/permissions', element: <GroupPermissionsPage /> },
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): group permissions matrix page (board × action × scope)"
git push
```

---

## Task 12 — `/admin/users/:userId/permissions` per-user override view

**Files:**
- Create: `src/features/permissions/hooks/useUserOverrides.ts`
- Create: `src/features/permissions/hooks/useUpsertUserOverride.ts`
- Create: `src/features/permissions/hooks/useDeleteUserOverride.ts`
- Create: `src/features/permissions/hooks/useUserEffectivePermissions.ts`
- Create: `src/features/permissions/UserPermissionsPage.tsx`
- Modify: `src/app/router.tsx` — add the route

- [ ] **Step 1: Hooks**

```ts
// useUserOverrides.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

export type UserOverrideRow = {
  id: string;
  user_id: string;
  board: Board;
  action: Action;
  scope: Scope;
  allowed: boolean;
};

export function useUserOverrides(userId: string) {
  return useQuery({
    queryKey: queryKeys.userOverrides(userId),
    queryFn: async (): Promise<UserOverrideRow[]> => {
      const { data, error } = await supabase
        .from('user_permissions')
        .select('id, user_id, board, action, scope, allowed')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as UserOverrideRow[];
    },
    enabled: !!userId,
  });
}
```

```ts
// useUpsertUserOverride.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

type Vars = {
  userId: string;
  board: Board;
  action: Action;
  allowed: boolean;
  scope: Scope;
};

export function useUpsertUserOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, board, action, allowed, scope }: Vars) => {
      const { error } = await supabase
        .from('user_permissions')
        .upsert(
          { user_id: userId, board, action, allowed, scope },
          { onConflict: 'user_id,board,action' },
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.userOverrides(vars.userId) });
      void qc.invalidateQueries({ queryKey: queryKeys.effectivePermissions(vars.userId) });
    },
  });
}
```

```ts
// useDeleteUserOverride.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useDeleteUserOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, id }: { userId: string; id: string }) => {
      const { error } = await supabase.from('user_permissions').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.userOverrides(vars.userId) });
    },
  });
}
```

```ts
// useUserEffectivePermissions.ts — read-only view of computed perms
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

export type EffectivePermissionRow = {
  user_id: string;
  board: Board;
  action: Action;
  allowed: boolean;
  scope: Scope | null;
};

export function useUserEffectivePermissions(userId: string) {
  return useQuery({
    queryKey: queryKeys.effectivePermissions(userId),
    queryFn: async (): Promise<EffectivePermissionRow[]> => {
      const { data, error } = await supabase
        .from('user_effective_permissions')
        .select('user_id, board, action, allowed, scope')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as EffectivePermissionRow[];
    },
    enabled: !!userId,
  });
}
```

- [ ] **Step 2: Page**

```tsx
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUser } from '@/features/users/hooks/useUser';
import { useUserOverrides } from './hooks/useUserOverrides';
import { useUpsertUserOverride } from './hooks/useUpsertUserOverride';
import { useDeleteUserOverride } from './hooks/useDeleteUserOverride';
import { useUserEffectivePermissions } from './hooks/useUserEffectivePermissions';
import { ALL_ACTIONS, ALL_BOARDS, ALL_SCOPES, type Action, type Board, type Scope } from '@/lib/permissions';

export function UserPermissionsPage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const { t } = useTranslation('admin');
  const { data: user } = useUser(userId);
  const { data: overrides = [] } = useUserOverrides(userId);
  const { data: effective = [], isLoading } = useUserEffectivePermissions(userId);
  const upsert = useUpsertUserOverride();
  const del = useDeleteUserOverride();

  if (!user) return <div className="p-8">…</div>;
  if (isLoading) return <div className="p-8">…</div>;

  const overrideMap = new Map(overrides.map((o) => [`${o.board}:${o.action}`, o]));
  const effectiveMap = new Map(effective.map((e) => [`${e.board}:${e.action}`, e]));

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">
        {t('permissions.user_title', { user: user.full_name || user.email })}
      </h1>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left">
            <th className="py-2 px-3">{/* Board × Action */}</th>
            {ALL_ACTIONS.map((a) => (
              <th key={a} className="py-2 px-3 align-bottom">
                <div className="rotate-180 text-xs [writing-mode:vertical-rl]">
                  {t(`permissions.actions.${a}`)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_BOARDS.map((b) => (
            <tr key={b} className="border-b">
              <th className="py-2 px-3 text-left font-medium">{t(`permissions.boards.${b}`)}</th>
              {ALL_ACTIONS.map((a) => {
                const eff = effectiveMap.get(`${b}:${a}`);
                const ov = overrideMap.get(`${b}:${a}`);
                const allowed = ov ? ov.allowed : (eff?.allowed ?? false);
                const scope = ov?.scope ?? eff?.scope ?? 'own';
                return (
                  <td key={a} className="py-2 px-3 align-middle">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        <Checkbox
                          checked={allowed}
                          onCheckedChange={(v) => {
                            void upsert.mutateAsync({
                              userId,
                              board: b as Board,
                              action: a as Action,
                              allowed: v === true,
                              scope,
                            });
                          }}
                        />
                        {ov && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void del.mutateAsync({ userId, id: ov.id })}
                          >
                            ×
                          </Button>
                        )}
                      </div>
                      {allowed && (
                        <Select
                          value={scope}
                          onValueChange={(s) => {
                            void upsert.mutateAsync({
                              userId,
                              board: b as Board,
                              action: a as Action,
                              allowed: true,
                              scope: s as Scope,
                            });
                          }}
                        >
                          <SelectTrigger className="h-7 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_SCOPES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {t(`permissions.scopes.${s}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {!ov && eff && (
                        <span className="text-xs text-muted-foreground">
                          {t('permissions.from_groups')}
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add route**

```tsx
import { UserPermissionsPage } from '@/features/permissions/UserPermissionsPage';
// inside admin children:
{ path: 'users/:userId/permissions', element: <UserPermissionsPage /> },
```

- [ ] **Step 4: Add link from `/admin/users/:userId` page**

Read `src/features/users/UserDetailPage.tsx`. After the Save/Deactivate buttons, add a link:

```tsx
<Link to={`/admin/users/${userId}/permissions`} className="text-sm text-blue-600 underline">
  {t('admin:permissions.title', { group: '' }).replace(' for ', '')}
</Link>
```

(Or simpler — pull from `users` namespace later. For Phase 2, hardcode "Permissions" with i18n via `useTranslation('admin')` — but UserDetailPage is in `users` namespace. Just fetch via `t('admin:permissions.title', ...)` after `useTranslation('users')` — i18next supports cross-namespace prefix.)

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
const { t } = useTranslation(['users', 'admin']);
// ...
<Link to={`/admin/users/${userId}/permissions`} className="text-sm text-blue-600 underline">
  {t('admin:nav.groups')}
</Link>
```

Use `t('admin:permissions.user_title', { user: '' })` if you want a tidier label, or keep it simple with `Permissions`.

For brevity in this plan, hardcoded label fix in code:

```tsx
<Link to={`/admin/users/${userId}/permissions`} className="text-sm text-blue-600 underline">
  Permissions
</Link>
```

(English-only label is acceptable here; expand to i18n later if it bothers you.)

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): per-user permissions page with effective view + overrides"
git push
```

---

## Task 13 — `/admin/fields` field-level rules editor

**Files:**
- Create: `src/features/permissions/hooks/useFieldRules.ts`
- Create: `src/features/permissions/hooks/useUpsertFieldRule.ts`
- Create: `src/features/permissions/hooks/useDeleteFieldRule.ts`
- Create: `src/features/permissions/FieldRulesPage.tsx`
- Modify: `src/app/router.tsx` — add the route

- [ ] **Step 1: Hooks**

```ts
// useFieldRules.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type FieldRuleRow = {
  id: string;
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: 'hidden' | 'readonly';
};

export function useFieldRules() {
  return useQuery({
    queryKey: queryKeys.fieldPermissions(),
    queryFn: async (): Promise<FieldRuleRow[]> => {
      const { data, error } = await supabase
        .from('field_permissions')
        .select('id, scope_type, scope_id, table_name, field_name, mode')
        .order('table_name')
        .order('field_name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FieldRuleRow[];
    },
  });
}
```

```ts
// useUpsertFieldRule.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = {
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: 'hidden' | 'readonly';
};

export function useUpsertFieldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const { error } = await supabase
        .from('field_permissions')
        .upsert(vars, { onConflict: 'scope_type,scope_id,table_name,field_name' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.fieldPermissions() });
    },
  });
}
```

```ts
// useDeleteFieldRule.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useDeleteFieldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_permissions').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.fieldPermissions() });
    },
  });
}
```

- [ ] **Step 2: FieldRulesPage**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useGroups } from '@/features/groups/hooks/useGroups';
import { useUsers } from '@/features/users/hooks/useUsers';
import { useFieldRules } from './hooks/useFieldRules';
import { useUpsertFieldRule } from './hooks/useUpsertFieldRule';
import { useDeleteFieldRule } from './hooks/useDeleteFieldRule';

const KNOWN_TABLES = ['clients', 'deals', 'jobs', 'monthly_invoices', 'profiles'] as const;

export function FieldRulesPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const { data: users = [] } = useUsers();
  const { data: rules = [], isLoading } = useFieldRules();
  const upsert = useUpsertFieldRule();
  const del = useDeleteFieldRule();

  const [draft, setDraft] = useState<{
    scope_type: 'group' | 'user';
    scope_id: string;
    table_name: string;
    field_name: string;
    mode: 'hidden' | 'readonly';
  }>({
    scope_type: 'group',
    scope_id: '',
    table_name: 'clients',
    field_name: '',
    mode: 'readonly',
  });

  if (isLoading) return <div className="p-8">…</div>;

  function labelForScope(scopeType: 'group' | 'user', scopeId: string) {
    if (scopeType === 'group') {
      const g = groups.find((x) => x.id === scopeId);
      return g ? g.display_names[lang] : scopeId;
    }
    const u = users.find((x) => x.user_id === scopeId);
    return u ? u.email : scopeId;
  }

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t('fields.title')}</h1>

      <div className="grid grid-cols-6 gap-2 rounded-md border p-4">
        <div>
          <Label>{t('fields.scope_type')}</Label>
          <Select
            value={draft.scope_type}
            onValueChange={(v) => setDraft({ ...draft, scope_type: v as 'group' | 'user', scope_id: '' })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="group">Group</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('fields.scope_value')}</Label>
          <Select value={draft.scope_id} onValueChange={(v) => setDraft({ ...draft, scope_id: v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(draft.scope_type === 'group' ? groups : users).map((opt) => (
                <SelectItem
                  key={'id' in opt ? opt.id : opt.user_id}
                  value={'id' in opt ? opt.id : opt.user_id}
                >
                  {'display_names' in opt ? opt.display_names[lang] : opt.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('fields.table')}</Label>
          <Select value={draft.table_name} onValueChange={(v) => setDraft({ ...draft, table_name: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {KNOWN_TABLES.map((tn) => (
                <SelectItem key={tn} value={tn}>{tn}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('fields.field')}</Label>
          <Input
            value={draft.field_name}
            onChange={(e) => setDraft({ ...draft, field_name: e.target.value })}
          />
        </div>
        <div>
          <Label>{t('fields.mode')}</Label>
          <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as 'hidden' | 'readonly' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hidden">{t('fields.modes.hidden')}</SelectItem>
              <SelectItem value="readonly">{t('fields.modes.readonly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            onClick={() => {
              if (!draft.scope_id || !draft.field_name) return;
              void upsert.mutateAsync(draft).then(() =>
                setDraft({ ...draft, scope_id: '', field_name: '' }),
              );
            }}
            disabled={upsert.isPending}
          >
            {t('fields.add')}
          </Button>
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">{t('fields.scope_type')}</th>
            <th className="py-2 pr-4">{t('fields.scope_value')}</th>
            <th className="py-2 pr-4">{t('fields.table')}</th>
            <th className="py-2 pr-4">{t('fields.field')}</th>
            <th className="py-2 pr-4">{t('fields.mode')}</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 pr-4">{r.scope_type}</td>
              <td className="py-2 pr-4">{labelForScope(r.scope_type, r.scope_id)}</td>
              <td className="py-2 pr-4">{r.table_name}</td>
              <td className="py-2 pr-4">{r.field_name}</td>
              <td className="py-2 pr-4">{t(`fields.modes.${r.mode}`)}</td>
              <td className="py-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void del.mutateAsync(r.id)}
                >
                  {t('fields.delete')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add route**

```tsx
import { FieldRulesPage } from '@/features/permissions/FieldRulesPage';
// inside admin children:
{ path: 'fields', element: <FieldRulesPage /> },
```

- [ ] **Step 4: Sidebar — add the link**

Add inside the `isAdmin` block of `Sidebar.tsx`:

```tsx
<NavLink to="/admin/fields" className={({ isActive }) =>
  `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
}>
  {t('admin:nav.fields')}
</NavLink>
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): /admin/fields page — manage hidden/readonly field rules"
git push
```

---

## Task 14 — `/admin/stages` pipeline-stage editor

**Files:**
- Create: `src/features/stages/hooks/usePipelineStages.ts`
- Create: `src/features/stages/hooks/useUpsertStage.ts`
- Create: `src/features/stages/hooks/useReorderStage.ts`
- Create: `src/features/stages/hooks/useArchiveStage.ts`
- Create: `src/features/stages/StagesListPage.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx` — add link

- [ ] **Step 1: Hooks**

```ts
// usePipelineStages.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type StageRow = {
  id: string;
  board: string;
  code: string;
  display_names: { en: string; el: string };
  position: number;
  color: string | null;
  is_terminal: boolean;
  terminal_outcome: string | null;
  triggers_action: string | null;
  archived: boolean;
};

export function usePipelineStages() {
  return useQuery({
    queryKey: queryKeys.pipelineStages(),
    queryFn: async (): Promise<StageRow[]> => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('board')
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as StageRow[];
    },
  });
}
```

```ts
// useUpsertStage.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = {
  id?: string;
  board: string;
  code: string;
  display_names: { en: string; el: string };
  position: number;
  color?: string | null;
  is_terminal?: boolean;
  terminal_outcome?: string | null;
  triggers_action?: string | null;
};

export function useUpsertStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      if (vars.id) {
        const { id, ...patch } = vars;
        const { error } = await supabase.from('pipeline_stages').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('pipeline_stages').insert(vars);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pipelineStages() });
    },
  });
}
```

```ts
// useReorderStage.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { StageRow } from './usePipelineStages';

export function useReorderStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      stages,
      stageId,
      direction,
    }: {
      stages: StageRow[];
      stageId: string;
      direction: 'up' | 'down';
    }) => {
      const sorted = stages.slice().sort((a, b) => a.position - b.position);
      const i = sorted.findIndex((s) => s.id === stageId);
      if (i < 0) return;
      const j = direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= sorted.length) return;
      const a = sorted[i]!;
      const b = sorted[j]!;
      // swap positions
      await supabase.from('pipeline_stages').update({ position: b.position }).eq('id', a.id);
      await supabase.from('pipeline_stages').update({ position: a.position }).eq('id', b.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pipelineStages() });
    },
  });
}
```

```ts
// useArchiveStage.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useArchiveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pipeline_stages').update({ archived: true }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pipelineStages() });
    },
  });
}
```

- [ ] **Step 2: StagesListPage**

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { usePipelineStages, type StageRow } from './hooks/usePipelineStages';
import { useReorderStage } from './hooks/useReorderStage';
import { useArchiveStage } from './hooks/useArchiveStage';

export function StagesListPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: stages = [], isLoading } = usePipelineStages();
  const reorder = useReorderStage();
  const archive = useArchiveStage();

  if (isLoading) return <div className="p-8">…</div>;

  // Group by board
  const byBoard = new Map<string, StageRow[]>();
  for (const s of stages) {
    if (s.archived) continue;
    const list = byBoard.get(s.board) ?? [];
    list.push(s);
    byBoard.set(s.board, list);
  }

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-bold">{t('stages.title')}</h1>
      {[...byBoard.entries()].map(([board, list]) => (
        <section key={board}>
          <h2 className="mb-2 text-lg font-medium">{t(`permissions.boards.${board}`)}</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">{t('stages.code')}</th>
                <th className="py-2 pr-4">{t('stages.name_en')}</th>
                <th className="py-2 pr-4">{t('stages.name_el')}</th>
                <th className="py-2 pr-4">{t('stages.position')}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.sort((a, b) => a.position - b.position).map((s, idx) => (
                <tr key={s.id} className="border-b">
                  <td className="py-2 pr-4 font-mono text-xs">{s.code}</td>
                  <td className="py-2 pr-4">{s.display_names.en}</td>
                  <td className="py-2 pr-4">{s.display_names.el}</td>
                  <td className="py-2 pr-4">{s.position}</td>
                  <td className="py-2 space-x-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={idx === 0}
                      onClick={() =>
                        void reorder.mutateAsync({ stages: list, stageId: s.id, direction: 'up' })
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={idx === list.length - 1}
                      onClick={() =>
                        void reorder.mutateAsync({ stages: list, stageId: s.id, direction: 'down' })
                      }
                    >
                      ↓
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void archive.mutateAsync(s.id)}
                    >
                      {t('stages.archive')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <div className="text-sm text-muted-foreground">
        Adding new stages via UI is deferred. For now, edit the seed migration and re-run if you need new stages.
        Display names: lang = {lang}.
      </div>
    </div>
  );
}
```

(Add-stage UI is intentionally deferred — Phase 2 focuses on reorder + archive. Adding new stages via UI is a Phase 8 polish task.)

- [ ] **Step 3: Add route**

```tsx
import { StagesListPage } from '@/features/stages/StagesListPage';
// inside admin children:
{ path: 'stages', element: <StagesListPage /> },
```

- [ ] **Step 4: Sidebar — add link**

```tsx
<NavLink to="/admin/stages" className={({ isActive }) =>
  `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
}>
  {t('admin:nav.stages')}
</NavLink>
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): /admin/stages — list + reorder + archive pipeline stages"
git push
```

---

## Task 15 — Permissions test page (proves field rules work end-to-end)

**Files:**
- Create: `src/features/permissions/PermissionsTestPage.tsx`
- Modify: `src/app/router.tsx`

- [ ] **Step 1: Test page**

```tsx
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldPermission } from './hooks/useFieldPermission';

export function PermissionsTestPage() {
  const { t } = useTranslation('admin');
  // Demo: read the rule for table='profiles', field='full_name' (any user/group).
  const mode = useFieldPermission('profiles', 'full_name');

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">{t('test_page.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('test_page.description')}</p>
      <p className="text-sm">{t('test_page.evaluation', { mode })}</p>

      {mode !== 'hidden' && (
        <div>
          <Label htmlFor="demo">{t('test_page.demo_field')}</Label>
          <Input id="demo" defaultValue="hello world" disabled={mode === 'readonly'} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add route**

```tsx
import { PermissionsTestPage } from '@/features/permissions/PermissionsTestPage';
// inside admin children:
{ path: 'permissions/test', element: <PermissionsTestPage /> },
```

(Optional sidebar link — skipped to keep sidebar lean.)

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): permissions test page (verifies useFieldPermission)"
git push
```

---

## Task 16 — SQL test suite for permissions engine

**Files:**
- Create: `supabase/tests/permissions_engine.sql`

These are SQL test cases run as the postgres role. The aim: prove `current_user_can()` and `user_effective_permissions` return correct values for various role configs.

- [ ] **Step 1: Test SQL**

```sql
-- supabase/tests/permissions_engine.sql
-- Run via: psql $SUPABASE_DB_URL -f supabase/tests/permissions_engine.sql
-- Or: supabase db reset (after configuring test seeds)

-- This test creates ephemeral test rows in a transaction and rolls back.
begin;

-- Create a fake auth user + profile + a test group + user_groups + group_permissions row.
-- Note: in production tests we'd use pgtap; this is a manual smoke script.

with new_user as (
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'test_perm@example.com')
  returning id
),
new_profile as (
  insert into public.profiles (user_id, email, full_name, must_change_password, is_admin)
  select id, 'test_perm@example.com', 'Test', false, false from new_user
  returning user_id
),
new_group as (
  insert into public.groups (code, display_names, parent_label, position)
  values ('test_group_xyz', '{"en": "Test", "el": "Test"}', 'Test', 999)
  returning id
),
membership as (
  insert into public.user_groups (user_id, group_id)
  select np.user_id, ng.id from new_profile np, new_group ng
  returning user_id, group_id
),
grant_view as (
  insert into public.group_permissions (group_id, board, action, scope, allowed)
  select id, 'sales', 'view', 'group', true from new_group
  returning id
)
select 'inserted: ' || count(*) as setup_ok from grant_view;

-- Verify: that test user can view sales (per group_permissions).
-- Use auth.uid() simulation: set the JWT context.

select set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.profiles where email='test_perm@example.com'))::text, true);

select 'group view allowed: ' || (current_user_can('sales','view'))::text;
select 'edit denied: ' || (not current_user_can('sales','edit'))::text;
select 'scope: ' || coalesce(current_user_scope('sales','view'), 'null');

-- Clean up
rollback;
```

- [ ] **Step 2: Run via psql (USER ACTION)**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "host=db.xujlrclyzxrvxszepquy.supabase.co port=5432 dbname=postgres user=postgres" -f supabase/tests/permissions_engine.sql
```

Expected output rows showing `setup_ok`, `group view allowed: true`, `edit denied: true`, `scope: group`.

If you don't have psql installed locally, run the file via Supabase Dashboard → SQL Editor.

- [ ] **Step 3: Commit (no app code changes)**

```bash
git add supabase/tests/permissions_engine.sql
git commit -m "test(db): SQL smoke tests for permissions engine"
git push
```

---

## Task 17 — Bootstrap default group permissions

**Files:** none new — runs SQL once

This task seeds reasonable defaults so brand-new groups already have a working permission set out of the gate. We do this **once** (idempotent insert).

- [ ] **Step 1: Run via Supabase SQL Editor (USER ACTION)**

```sql
-- Insert default permissions per group (idempotent).
-- Each group gets: view all on its own board + clients (group scope), comment + attach_file (group scope).
-- Sales also gets create/edit/delete/move_stage/lock_deal on sales board.
-- Accounting gets complete_accounting + block_client + unblock_client on accounting boards.
-- Tech sub-departments get move_stage + complete_job on their own board.
-- All groups get view (all) on permissions board denied — only admins see permissions.

with seed as (
  -- View on own board
  select id as group_id, code as board, 'view'::text as action, 'group'::text as scope, true as allowed
  from public.groups
  union all
  -- Sales actions on sales board
  select id, 'sales', 'create', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'edit', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'move_stage', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'comment', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'attach_file', 'group', true from public.groups where code = 'sales'
  union all select id, 'sales', 'lock_deal', 'group', true from public.groups where code = 'sales'
  union all
  -- Accounting on accounting boards
  select id, 'accounting_onboarding', 'edit', 'group', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'move_stage', 'group', true from public.groups where code = 'accounting'
  union all select id, 'accounting_onboarding', 'complete_accounting', 'group', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'view', 'group', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'edit', 'group', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'block_client', 'group', true from public.groups where code = 'accounting'
  union all select id, 'accounting_recurring', 'unblock_client', 'group', true from public.groups where code = 'accounting'
  union all
  -- Tech sub-departments on their own board
  select id, code, 'edit', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'move_stage', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'complete_job', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'comment', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
  union all select id, code, 'attach_file', 'group', true from public.groups where code in ('web_seo','local_seo','web_dev','social_media')
)
insert into public.group_permissions (group_id, board, action, scope, allowed)
select group_id, board, action, scope, allowed from seed
on conflict (group_id, board, action) do nothing;

select 'seeded: ' || count(*)::text from public.group_permissions;
```

Expected: `seeded: ~50`.

- [ ] **Step 2: Verify via REST**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')
curl -sS "${URL}/rest/v1/group_permissions?select=count" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -H 'Prefer: count=exact' -D - -o /dev/null 2>&1 | grep -i 'content-range'
```

Expected: count > 0.

- [ ] **Step 3: No commit** (this is operational data, not source code).

---

## Task 18 — Phase 2 acceptance + push

- [ ] **Step 1: Final local suite**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
```

All exit 0.

- [ ] **Step 2: Phase 2 acceptance criteria**

- [ ] Admin can navigate to `/admin/groups`, see all 6 groups with member counts.
- [ ] Admin can click "Manage permissions" → see the matrix at `/admin/groups/:id/permissions`, toggle a checkbox + scope, and have it persist (refresh page → still set).
- [ ] Admin can navigate to a user detail page → click "Permissions" → see effective permissions (computed from groups) + add overrides.
- [ ] Admin can navigate to `/admin/fields` → add a field rule (e.g., `clients.phone` hidden for `sales` group) → see it in the list.
- [ ] Admin can navigate to `/admin/stages` → see all stages grouped by board → reorder one with up/down → see new position.
- [ ] `/admin/permissions/test` correctly reports `editable` / `hidden` / `readonly` based on rules in DB for the current user.
- [ ] Non-admin users still cannot access any `/admin/*` route.
- [ ] All 6 admin pages have working Greek translations (visit each, switch locale, no missing-key markers).
- [ ] CI green on `main` after all Phase 2 commits.
- [ ] No real credentials committed.

- [ ] **Step 3: Manual smoke test (USER ACTION)**

Login at https://itdevcrm.vercel.app as admin (`info@itdev.gr` or `mkifokeris@itdev.gr`).

Walk through the 5 admin pages above. Tell me anything that looks wrong, broken, or visually off.

- [ ] **Step 4: Mark Phase 2 done**

Update `MEMORY.md` if needed; otherwise no extra commit.

---

## Out of scope for Phase 2 (do NOT do now)

- **DB-side field-level enforcement via security-definer views** — Phase 3+ when actual Phase-3 tables (clients, deals, jobs) exist.
- **Adding new pipeline stages from UI** — only reorder + archive in Phase 2; create-stage UI deferred to Phase 8.
- **Activity log diff viewer UI** — data is logged; UI is Phase 8.
- **Drag-and-drop stage reorder** — up/down buttons sufficient for MVP.
- **clients table** — Phase 3 creates it.

If a task starts touching any of the above, stop and revisit the spec.
