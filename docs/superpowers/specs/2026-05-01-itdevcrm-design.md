# ITDevCRM — Design Specification

| Field                 | Value                                                       |
| --------------------- | ----------------------------------------------------------- |
| **Date**              | 2026-05-01                                                  |
| **Status**            | Draft — pending user review                                 |
| **Scope (this spec)** | Phases 0–3 in full detail; Phases 4–8 acknowledged as stubs |
| **Stack**             | Vite + React + TypeScript + Supabase + Tailwind + shadcn/ui |

---

## 1. Problem & goals

Build a **custom internal CRM** for an agency that sells multi-service packages (Web SEO, Local SEO, Web Dev, Social Media), most of which are billed monthly. The CRM must support three operational departments — **Sales**, **Accounting**, **Technical** (with 4 sub-departments) — each with their own kanban workflows, statuses, and visibility rules. A custom permission system must let an admin control what each group and each individual user can see/do, including field-level access. Auth runs through Supabase (no email verification in MVP). UI is bilingual (English + Greek) from day 1.

### Success criteria for MVP (end of Phase 3)

1. An admin can invite users, assign them to one or more groups, and configure their permissions.
2. Sales staff can manage clients/deals through a 10-stage kanban, including comments, attachments, file uploads, @mentions, saved filters, and locking a deal once required fields are valid.
3. Permissions enforced both client-side (UI hiding) and server-side (RLS + field-restricted views).
4. Activity log captures every change automatically.
5. App is bilingual (EN/EL).
6. Phases 4–8 are not blocked by data-model or architectural choices made in MVP.

---

## 2. Out of scope (MVP)

Deferred to Phase 8 or later:

- Reporting / dashboards (revenue, MRR, conversion funnels)
- Global search across all entities
- Email integration (sending/receiving) and email verification
- Calendar integration
- Document generation (PDF proposals, contracts, invoices)
- Mobile-native UI (responsive only in MVP)
- Activity log diff-viewer UI (data is logged; no fancy viewer in MVP)
- Public client portal
- Time tracking on jobs
- 2FA
- Multi-currency (EUR only in MVP)
- Admin-configurable custom fields (fixed schema in MVP)
- Presence indicators ("X is also viewing this")
- ClickUp integration (Phase 7 — pending access)

---

## 3. Architecture overview

```
┌───────────────────────────────────────────────────────────────┐
│             Vite + React 18 + TypeScript (SPA)               │
│  React Router · TanStack Query · Zustand · Tailwind          │
│  shadcn/ui · dnd-kit · TanStack Table · RHF + Zod            │
│  react-i18next (EN + EL) · Vitest + RTL + Playwright         │
└──────────────────────────┬────────────────────────────────────┘
                           │ HTTPS / WebSocket
                           ▼
┌───────────────────────────────────────────────────────────────┐
│                    Supabase Cloud                             │
│  Postgres ─ Auth ─ Realtime ─ Storage ─ RLS                   │
└───────────────────────────────────────────────────────────────┘
```

**Hosting:** Cloudflare Pages or Netlify (free tier OK for MVP), Supabase Cloud (free tier in dev → Pro $25/mo at launch).

---

## 4. Tech stack

| Concern            | Choice                                                | Why                                                |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| Build tool         | Vite                                                  | Fast dev loop, minimal config                      |
| UI lib             | React 18                                              | Required by user                                   |
| Language           | TypeScript (strict)                                   | Type safety across permission/data model           |
| Routing            | React Router v6 (data routers)                        | Mature, plays well with Supabase auth gates        |
| Styling            | Tailwind CSS                                          | Per-card customisation per department              |
| UI primitives      | shadcn/ui (Radix-based, copy-paste)                   | Own the components, no version lock-in             |
| Server state       | TanStack Query v5                                     | Caching, optimistic kanban updates                 |
| Client state       | Zustand                                               | Auth user, current group, sidebar                  |
| Forms + validation | React Hook Form + Zod                                 | Schemas double as TS types and Supabase validators |
| Drag & drop        | `@dnd-kit/core` + `@dnd-kit/sortable`                 | Modern, accessible, performant                     |
| Tables             | TanStack Table v8                                     | Headless, pairs with Tailwind                      |
| Backend            | Supabase (Postgres + Auth + Realtime + Storage + RLS) | Locked by user                                     |
| i18n               | react-i18next                                         | EN + EL                                            |
| Testing            | Vitest, React Testing Library, Playwright             | Unit, component, e2e                               |
| Lint/format        | ESLint + Prettier + strict tsconfig                   | Free quality                                       |
| Deploy (frontend)  | Cloudflare Pages or Netlify                           | Free, commercial-OK                                |

### Operational cost (post-launch, baseline)

- **Supabase Pro** $25/mo (daily backups, no auto-pause)
- **Hosting** $0 (Cloudflare Pages or Netlify free tier)
- **Domain** ~$1/mo
- **Total: ~$26/mo, ~$315/yr**

---

## 5. Domain model

```
        ┌──────────────────┐
        │     clients      │  (companies we sell to)
        └────────┬─────────┘
                 │ 1:N
                 ▼
        ┌──────────────────┐
        │      deals       │  (a sale opportunity)
        └────────┬─────────┘
                 │ 1:N
                 ▼
        ┌──────────────────┐
        │       jobs       │  (one per service in the deal:
        └────────┬─────────┘   web_seo, local_seo, web_dev, social_media;
                 │              one_time OR recurring_monthly)
                 │
        ┌────────┴────────┐
        ▼                 ▼
  monthly_invoices   client_blocks
  (per client/month) (block flag)
        │
        ▼
  monthly_invoice_items
  (per job per month, rolls up into client invoice)
```

A **deal** is one sale event. After lock + accounting completion, **jobs** are spawned (one per service the client bought). Each job has its own lifecycle on its sub-department's kanban. Most jobs are recurring monthly; some (like Web Dev) are one-time. Recurring billing aggregates all of a client's active recurring jobs into a single **monthly invoice** per period.

---

## 6. Database schema

All tables include `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()` unless noted. Soft delete columns (`archived BOOLEAN DEFAULT false`, `archived_at TIMESTAMPTZ`, `archived_by UUID`, `archived_reason TEXT`) on every business-data table.

### 6.1 Identity & groups

```sql
profiles                       -- extends auth.users
  user_id UUID PK FK auth.users
  full_name TEXT NOT NULL
  email TEXT NOT NULL UNIQUE
  avatar_url TEXT
  is_admin BOOLEAN DEFAULT false
  is_active BOOLEAN DEFAULT true
  must_change_password BOOLEAN DEFAULT true
  preferred_locale TEXT DEFAULT 'en'   -- 'en' | 'el'

groups
  id UUID PK
  code TEXT UNIQUE  -- 'sales','accounting','web_seo','local_seo','web_dev','social_media'
  display_name TEXT
  parent_label TEXT  -- UI grouping only: 'Sales' | 'Accounting' | 'Technical'
  position INT

user_groups
  user_id UUID FK profiles.user_id
  group_id UUID FK groups.id
  PRIMARY KEY (user_id, group_id)
```

Seeded `groups`: 6 rows (sales, accounting, web_seo, local_seo, web_dev, social_media). `parent_label` is purely a UI hint so the sidebar can render Web SEO/Local SEO/Web Dev/Social Media under a "Technical" header.

### 6.2 Pipeline stages (configurable)

```sql
pipeline_stages
  id UUID PK
  board TEXT NOT NULL
    -- 'sales' | 'accounting_onboarding' | 'web_seo' | 'local_seo' | 'web_dev' | 'social_media'
  code TEXT NOT NULL  -- machine name, stable
  display_names JSONB NOT NULL  -- {"en": "New Lead", "el": "Νέος Πελάτης"}
  position INT NOT NULL
  color TEXT  -- hex, for kanban column header
  is_terminal BOOLEAN DEFAULT false
  terminal_outcome TEXT  -- 'won' | 'lost' | 'paid' | 'completed' | 'cancelled' | NULL
  triggers_action TEXT   -- 'lock_deal' | 'complete_accounting' | NULL
  archived BOOLEAN DEFAULT false
  UNIQUE (board, code)
```

#### Seeded stages

(Display names below shown in English; Greek translations seeded alongside in `display_names` JSONB. Greek strings to be confirmed by a fluent reviewer — see Risks R2.)

**Sales board:**

1. `new_lead` → New Lead
2. `no_answer` → No Answer
3. `constant_na` → Constant NA
4. `working_on_it` → Working On It
5. `offer_sent` → Offer Sent
6. `scheduled` → Scheduled
7. `hot` → Hot
8. `won` → Won (terminal=true, outcome=won, triggers_action=lock_deal)
9. `not_interested` → Not Interested (terminal=true, outcome=lost)
10. `dead_end` → Dead End (terminal=true, outcome=lost)

**Accounting onboarding board:**

1. `new` → New
2. `documents_verified` → Documents Verified
3. `invoice_issued` → Invoice Issued
4. `awaiting_payment` → Awaiting Payment
5. `partial_payment` → Partial Payment
6. `paid_in_full` → Paid In Full (terminal=true, outcome=paid, triggers_action=complete_accounting)
7. `on_hold` → On Hold (side state)
8. `refunded` → Refunded (terminal=true, outcome=cancelled)

**Web SEO / Local SEO / Social Media boards** (recurring services, identical lifecycle shape):

1. `onboarding` → Onboarding
2. `audit_strategy` (Web SEO) / `gbp_setup` (Local SEO) / `content_plan_approval` (Social Media) → varies
3. `active` → Active
4. `on_hold` → On Hold
5. `cancelled` → Cancelled (terminal=true, outcome=cancelled)

**Web Dev board** (one-time):

1. `awaiting_brief` → Awaiting Brief
2. `discovery` → Discovery
3. `wireframes` → Wireframes
4. `design` → Design
5. `development` → Development
6. `internal_qa` → Internal QA
7. `client_review` → Client Review
8. `revisions` → Revisions
9. `live` → Live (terminal=true, outcome=completed)
10. `maintenance` → Maintenance (terminal=true, outcome=completed) — does NOT auto-spawn recurring; sales must sell maintenance separately

### 6.3 Permissions (3 layers)

```sql
group_permissions
  id UUID PK
  group_id UUID FK groups.id
  board TEXT NOT NULL
  action TEXT NOT NULL
    -- 'view','create','edit','delete','move_stage','assign_owner',
    -- 'comment','attach_file','lock_deal','complete_accounting',
    -- 'block_client','unblock_client','complete_job'
  scope TEXT NOT NULL
    -- 'own' | 'group' | 'all'
  allowed BOOLEAN DEFAULT true
  UNIQUE (group_id, board, action)

user_permissions
  id UUID PK
  user_id UUID FK profiles.user_id
  board TEXT NOT NULL
  action TEXT NOT NULL
  scope TEXT NOT NULL
  allowed BOOLEAN  -- true=grant, false=revoke beyond group default
  UNIQUE (user_id, board, action)

field_permissions
  id UUID PK
  scope_type TEXT NOT NULL  -- 'group' | 'user'
  scope_id UUID NOT NULL
  table_name TEXT NOT NULL  -- 'clients' | 'deals' | 'jobs' | 'monthly_invoices' | ...
  field_name TEXT NOT NULL
  mode TEXT NOT NULL  -- 'hidden' | 'readonly'
  UNIQUE (scope_type, scope_id, table_name, field_name)
```

**Effective permission resolution:**

For each `(user, board, action)`, compute the effective scope and `allowed` flag:

1. Start from union of `group_permissions` across all groups the user belongs to. If multiple, take the most permissive scope (`all` > `group` > `own`).
2. Apply `user_permissions` overrides (any matching row wins over group default; `allowed=false` revokes).
3. `is_admin = true` short-circuits to `allowed=true, scope='all'`.

For each `(user, table, field)`, compute display mode:

1. If any `field_permissions` row matches user (scope_type='user'), use it.
2. Else, if any `field_permissions` row matches a group the user belongs to, take the most-restrictive (`hidden` > `readonly` > none).
3. Else `editable`.

Effective permissions are exposed to React via a single SQL view `user_effective_permissions` that joins all three tables.

### 6.4 Clients / Deals / Jobs

```sql
clients
  id UUID PK
  name TEXT NOT NULL                  -- company name
  contact_first_name TEXT
  contact_last_name TEXT
  email TEXT
  phone TEXT
  website TEXT
  industry TEXT
  country TEXT
  region TEXT
  city TEXT
  address TEXT
  postcode TEXT
  vat_number TEXT
  lead_source TEXT
  assigned_owner_id UUID FK profiles.user_id
  -- soft delete cols

deals
  id UUID PK
  client_id UUID FK clients.id
  title TEXT NOT NULL
  description TEXT
  expected_close_date DATE
  actual_close_date DATE
  probability INT CHECK (probability BETWEEN 0 AND 100)
  lead_source TEXT
  stage_id UUID FK pipeline_stages.id
  owner_user_id UUID FK profiles.user_id
  currency TEXT DEFAULT 'EUR'
  one_time_value NUMERIC(12,2)         -- computed sum from jobs (trigger-maintained)
  recurring_monthly_value NUMERIC(12,2) -- computed sum from jobs
  locked_at TIMESTAMPTZ
  locked_by UUID FK profiles.user_id
  accounting_completed_at TIMESTAMPTZ
  accounting_completed_by UUID FK profiles.user_id
  -- soft delete cols

jobs
  id UUID PK
  deal_id UUID FK deals.id
  client_id UUID FK clients.id        -- denormalised
  service_type TEXT NOT NULL
    -- 'web_seo' | 'local_seo' | 'web_dev' | 'social_media'
  billing_type TEXT NOT NULL
    -- 'one_time' | 'recurring_monthly'
  one_time_amount NUMERIC(12,2)
  monthly_amount NUMERIC(12,2)
  setup_fee NUMERIC(12,2)
  recurring_start_date DATE
  stage_id UUID FK pipeline_stages.id
  owner_user_id UUID FK profiles.user_id
  assigned_group_id UUID FK groups.id  -- the sub-dept owning this job
  status TEXT NOT NULL DEFAULT 'active'
    -- 'active' | 'paused' | 'cancelled' | 'completed'
  monthly_tasks JSONB DEFAULT '[]'     -- [{id, label_i18n, done, done_at, done_by}, ...]
  monthly_tasks_period TEXT            -- 'YYYY-MM' the checklist applies to
  started_at TIMESTAMPTZ
  completed_at TIMESTAMPTZ
  -- soft delete cols
  CONSTRAINT job_stage_matches_service
    CHECK (
      (service_type = 'web_seo'      AND stage_board(stage_id) = 'web_seo')
      OR (service_type = 'local_seo' AND stage_board(stage_id) = 'local_seo')
      OR (service_type = 'web_dev'   AND stage_board(stage_id) = 'web_dev')
      OR (service_type = 'social_media' AND stage_board(stage_id) = 'social_media')
    )
  -- stage_board is a small immutable SQL function returning pipeline_stages.board for a given id

service_task_templates
  id UUID PK
  service_type TEXT NOT NULL UNIQUE
    -- 'web_seo' | 'local_seo' | 'web_dev' | 'social_media'
  tasks JSONB NOT NULL
    -- [{id, label_i18n: {en, el}, default_done: false}, ...]
```

When a job is created (or on the 1st of each month for recurring jobs), `monthly_tasks` is initialised by copying the template for the job's `service_type` from `service_task_templates`. The template is admin-editable in Phase 6 (until then, seeded defaults per service).

**Lock-deal validation (server-side, in `lock_deal` RPC):**

- `deal.one_time_value + deal.recurring_monthly_value > 0`
- At least one `jobs` row exists for the deal
- Client has `email` AND (`phone` OR `address`)
- At least one `attachments` row with `kind = 'contract'` on the deal
- Returns `{ ok: false, errors: [...] }` if invalid; the kanban Won column refuses the drop.
- On success: sets `actual_close_date = current_date`, `locked_at = now()`, `locked_by = auth.uid()`, and creates the Accounting onboarding record (deal stage moves to `won`).

### 6.5 Recurring billing

```sql
monthly_invoices
  id UUID PK
  client_id UUID FK clients.id
  period TEXT NOT NULL  -- 'YYYY-MM'
  due_date DATE NOT NULL
  subtotal NUMERIC(12,2) NOT NULL
  tax_rate NUMERIC(5,2)
  tax_amount NUMERIC(12,2)
  total_amount NUMERIC(12,2) NOT NULL
  amount_paid NUMERIC(12,2) DEFAULT 0
  status TEXT NOT NULL
    -- 'pending' | 'partial' | 'paid' | 'overdue'
  payment_method TEXT
  paid_at TIMESTAMPTZ
  notes TEXT
  -- soft delete cols
  UNIQUE (client_id, period)

monthly_invoice_items
  id UUID PK
  invoice_id UUID FK monthly_invoices.id ON DELETE CASCADE
  job_id UUID FK jobs.id
  service_type TEXT          -- denormalised for display
  amount NUMERIC(12,2) NOT NULL
  description TEXT

client_blocks
  id UUID PK
  client_id UUID FK clients.id
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  blocked_by UUID FK profiles.user_id
  reason TEXT NOT NULL
  unblocked_at TIMESTAMPTZ
  unblocked_by UUID FK profiles.user_id
  PARTIAL UNIQUE INDEX (client_id) WHERE unblocked_at IS NULL
```

**Invoice generation** (manual in MVP): admin/accountant clicks "Generate invoices for this month" → server `generate_monthly_invoices(period TEXT)` RPC inserts one `monthly_invoices` row per client with active recurring jobs + one `monthly_invoice_items` row per active recurring job, with `due_date = period start + N days` (configurable, default 14). Idempotent: if invoice already exists for `(client_id, period)`, function skips.

**Overdue auto-flag:** a `pg_cron` job runs daily at 02:00 UTC executing `mark_overdue_invoices()` which updates `status='overdue'` for unpaid invoices past `due_date`. (Supabase supports `pg_cron`; falls back to a scheduled Supabase Edge Function if `pg_cron` is unavailable in the chosen tier.)

`monthly_invoices` covers **only recurring billing**. One-time service payments (e.g., Web Dev project fees) are tracked through the Accounting onboarding kanban's `paid_in_full` stage and do not generate `monthly_invoices` rows.

**Block semantics (soft block):** Tech kanbans show `Blocked – Awaiting Accounting` badge on every card whose `client_id` has an active row in `client_blocks`. The `move_stage` action is denied via RLS while the block is active, but `comment`, `attach_file`, and `edit` (non-stage fields) remain allowed.

### 6.6 Collaboration

```sql
comments
  id UUID PK
  parent_type TEXT NOT NULL  -- 'client' | 'deal' | 'job'
  parent_id UUID NOT NULL
  author_id UUID FK profiles.user_id
  body TEXT NOT NULL
  mentioned_user_ids UUID[] DEFAULT '{}'
  -- soft delete cols

attachments
  id UUID PK
  parent_type TEXT NOT NULL  -- 'client' | 'deal' | 'job'
  parent_id UUID NOT NULL
  storage_path TEXT NOT NULL  -- path in Supabase Storage
  file_name TEXT NOT NULL
  file_size INT
  mime_type TEXT
  uploaded_by UUID FK profiles.user_id
  kind TEXT  -- 'contract' | 'invoice' | 'other' (free tags)

activity_log
  id UUID PK
  entity_type TEXT NOT NULL   -- 'client' | 'deal' | 'job' | 'invoice' | 'user'
  entity_id UUID NOT NULL
  user_id UUID FK profiles.user_id
  action TEXT NOT NULL  -- 'create' | 'update' | 'delete' | 'lock' | 'block' | ...
  changes JSONB         -- {field: {old, new}, ...}
  created_at TIMESTAMPTZ DEFAULT now()

notifications
  id UUID PK
  user_id UUID FK profiles.user_id
  type TEXT NOT NULL  -- 'mention' | 'block' | 'lock_deal' | ...
  payload JSONB NOT NULL
  read_at TIMESTAMPTZ
  created_at TIMESTAMPTZ DEFAULT now()

saved_filters
  id UUID PK
  user_id UUID FK profiles.user_id
  board TEXT NOT NULL  -- or 'global'
  name TEXT NOT NULL
  filter_json JSONB NOT NULL  -- {stage_ids: [...], owner: '...', search: '...'}
  position INT
```

`activity_log` is populated automatically via a generic Postgres trigger that captures OLD/NEW row diffs on every INSERT/UPDATE/DELETE on tracked tables.

`notifications` are inserted by a trigger when `mentioned_user_ids` changes on a comment, and on key workflow events (deal locked, accounting completed, client blocked/unblocked). Pushed to clients via Supabase Realtime.

**On the polymorphic `parent_type/parent_id` pattern in `comments`, `attachments`, `activity_log`:** Postgres cannot enforce true FK constraints on a polymorphic relationship. Integrity is maintained by:

- App-side enforcement: only valid `parent_type` values (`'client' | 'deal' | 'job'`) are accepted via Zod schema.
- A check trigger that validates the `parent_id` exists in the matching parent table before insert/update.
- Cascading soft-deletes propagated by triggers (when a parent row is archived, its comments/attachments are flagged accordingly).

Alternative considered (separate tables per parent type, e.g., `client_comments`/`deal_comments`/`job_comments`) was rejected: 3× the table maintenance, no real safety gain in our context, and the unified UI component is cleaner.

---

## 7. RLS & permission enforcement

Every business table has Row Level Security enabled. Policies reference the `user_effective_permissions` view computed from `group_permissions` + `user_permissions` + `is_admin`.

Pattern (illustrative, for `deals`):

```sql
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY deals_select ON deals FOR SELECT
USING (
  is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM user_effective_permissions p
    WHERE p.user_id = auth.uid()
      AND p.board = 'sales'
      AND p.action = 'view'
      AND p.allowed = true
      AND (
        (p.scope = 'all')
        OR (p.scope = 'group' AND deals.owner_user_id IN
            (SELECT ug2.user_id FROM user_groups ug2
             WHERE ug2.group_id IN
               (SELECT ug.group_id FROM user_groups ug WHERE ug.user_id = auth.uid())))
        OR (p.scope = 'own' AND deals.owner_user_id = auth.uid())
      )
  )
);

-- Similar policies for INSERT, UPDATE, DELETE referencing 'create','edit','delete' actions.
```

### Field-level enforcement

- **App-side:** every form/table/card consults a `useFieldPermission(table, field)` hook → renders `null` for hidden, `<ReadOnlyField>` for readonly, normal input for editable.
- **DB-side defense-in-depth (sensitive fields only):** financial/sensitive fields exposed via security-definer views (`deals_safe`, `jobs_safe`, `monthly_invoices_safe`) that `CASE WHEN field_is_hidden_for_caller(...)` and return `NULL`. The React app reads through these views by default; raw tables are not directly readable for those fields.

### Realtime + RLS

Supabase Realtime respects RLS — users only receive change events for rows they're allowed to see. No additional filtering needed.

---

## 8. Workflows

### 8.1 Sales pipeline

1. Lead enters as a new client + new deal at `new_lead` stage.
2. Sales drags card across `New Lead → No Answer → Constant NA → Working On It → Offer Sent → Scheduled → Hot`.
3. To drop into `Won`, server-side validation runs (see 6.4 lock-deal validation). On success: `lock_deal` action fires → deal becomes immutable for sales (except notes/files/activity), an `accounting_onboarding` deal record is created, the client appears on the Accounting kanban at `new` stage.
4. `Not Interested` and `Dead End` are terminal-lost — card visually fades, archived view by default.

### 8.2 Accounting onboarding

1. New deal lands at `new`. Accountant verifies docs → moves to `documents_verified`.
2. Issues invoice → `invoice_issued`; awaits payment → `awaiting_payment`; tracks partials in `partial_payment`.
3. Reaching `paid_in_full` triggers `complete_accounting`:
   - Validates: invoice number set, amount_paid ≥ total_amount, all services have a quoted amount.
   - Spawns one `jobs` row per service in the deal, in the appropriate sub-department's `onboarding` stage.
   - Deal exits Accounting kanban → enters Accounting Recurring view (if any recurring jobs).
4. `On Hold` and `Refunded` are side states.

### 8.3 Accounting recurring (monthly billing)

- Every month, accountant clicks "Generate invoices for {month}" → server inserts `monthly_invoices` + `monthly_invoice_items` rows per client with active recurring jobs.
- Accountant marks payments received (manual in MVP).
- Daily job marks unpaid past-due invoices `overdue`.
- Accountant can **block** any client → toggles soft-block on all their jobs across tech sub-boards.

### 8.4 Technical sub-departments

- Recurring services (Web SEO / Local SEO / Social Media): job advances `onboarding → audit_or_setup → active → (on_hold) → cancelled`. Stays in `active` for months/years. Each card has a **monthly task panel** (configurable JSONB checklist per service) that resets on the 1st of each month (job's `monthly_tasks_period` reset by daily job; old period archived to `activity_log`).
- One-time service (Web Dev): full lifecycle from `awaiting_brief` to `live` or `maintenance`. Maintenance does NOT auto-create a recurring job (sales sells maintenance as separate service).
- A blocked client's cards display a `Blocked – Awaiting Accounting` badge; `move_stage` denied; other actions allowed.

### 8.5 Cross-department visibility ("My Clients")

Each group has a "My Clients" page showing every client where the group has, or had within the last 90 days, a job in any non-cancelled state. Sortable, searchable, filterable. Same rule appears as a kanban filter chip (toggle "Show all my group's clients"). An "Include archived" toggle expands to all-time history. Implemented as a SQL view per group + TanStack Table.

---

## 9. Auth & onboarding

- **Invite-only**: admin creates user from `/admin/users` → fills name/email/groups → sets a temporary password.
- User logs in with temp password → forced to change on first login (`profiles.must_change_password = true` flow).
- Password reset = admin-driven (no email infrastructure in MVP).
- Default groups: none — admin must select at creation time.
- Deactivation = soft (`is_active=false`); no hard-delete UI.
- Session: Supabase default (idle timeout 7 days, JWT auto-refresh on activity).

---

## 10. Internationalization (EN + EL)

- **react-i18next** with language detection from `profiles.preferred_locale` (fallback to browser language → English).
- All UI strings externalised to `src/i18n/locales/{en,el}/{namespace}.json`.
- Pipeline stage display names stored as a JSONB `display_names` column on `pipeline_stages` (e.g., `{"en": "New Lead", "el": "Νέος Πελάτης"}`). Resolved at render time using current user's `preferred_locale` with English fallback.
- Date/number formatting via `Intl.*` with locale.
- Currency always displayed as EUR (no FX in MVP).
- Greek translations written alongside English from day 1; no late-stage retrofit.

---

## 11. Frontend architecture

### Folder structure

```
src/
  app/                  # router setup, root layout, auth guard
  features/
    auth/               # login, set-password, password-change-on-first-login
    users/              # admin user list, user detail, deactivation
    permissions/        # group matrix, user effective view, field rules, stage editor
    clients/            # client list, client detail, client form
    sales/              # sales kanban, sales "My Clients" page
    accounting/         # onboarding kanban, recurring table, invoice gen, blocking
    technical/
      web_seo/          # board + monthly tasks panel
      local_seo/
      web_dev/
      social_media/
    deals/              # deal detail page, deal form
    jobs/               # job detail page, job form
    comments/           # shared comments component (parent_type/id)
    attachments/        # shared attachments component
    activity/           # shared activity-log tab
    notifications/      # bell icon, notification feed
    saved_filters/      # shared saved-filter UI
  components/           # shadcn/ui + shared layout (sidebar, topbar, dialogs)
  lib/
    supabase.ts         # supabase client singleton
    queryClient.ts      # tanstack query client
    permissions.ts      # useEffectivePermission, useFieldPermission hooks
    i18n.ts             # react-i18next setup
    realtime.ts         # subscription helpers
  hooks/
  types/                # zod schemas + generated supabase types
  i18n/locales/{en,el}/
  tests/                # playwright e2e specs
supabase/
  migrations/           # SQL migrations (versioned)
  seed.sql              # seeds groups, default stages
  functions/            # edge functions (later phases)
```

### Routing map

```
/login
/set-password               (first-login forced password change)
/                           redirects to user's default board (first group's kanban)
/sales/kanban
/sales/clients              "My Clients" page
/accounting/onboarding
/accounting/recurring
/accounting/clients
/tech/web-seo/kanban
/tech/web-seo/clients
/tech/local-seo/...         (parallel)
/tech/web-dev/...           (parallel)
/tech/social-media/...      (parallel)
/clients/:id                universal client detail
/deals/:id                  universal deal detail
/jobs/:id                   universal job detail
/admin/users
/admin/users/:id/permissions
/admin/groups
/admin/groups/:id/permissions
/admin/fields                field-level rules
/admin/stages                pipeline stage editor
/admin/audit                 activity-log search (basic table view)
/profile                     current user's profile + change password
```

### State

- **Server state** → TanStack Query. One query key per `(table, filters)`. Optimistic updates on kanban drag/drop with rollback on error.
- **Client state** → Zustand: `useAuthStore` (current user + groups + effective permissions snapshot), `useUIStore` (sidebar collapsed, locale toggle).
- **Realtime** → on kanban mount, subscribe to relevant table changes filtered by `board`/`assigned_group_id`. On entity detail mount, subscribe to that row + related comments/activity.

### Component conventions

- One feature = one folder with `index.ts` exporting public symbols only.
- `*Page` components are route-mounted; everything else is internal.
- All forms are RHF + Zod; submit handler always calls a TanStack Query mutation.
- Permission-aware rendering wraps actions in `<RequirePermission board="..." action="...">{children}</RequirePermission>` — hides the button when not allowed but is NOT the security boundary; RLS is.

---

## 12. Realtime strategy

| Surface                            | Realtime? | Notes                                                           |
| ---------------------------------- | --------- | --------------------------------------------------------------- |
| Kanban boards                      | Yes       | Subscribe to `deals`/`jobs` filtered by board                   |
| Entity detail pages                | Yes       | Subscribe to row + `comments`/`activity_log` filtered by parent |
| Notifications                      | Yes       | Subscribe to `notifications WHERE user_id = me`                 |
| Tables ("My Clients", admin lists) | No        | Refetch on focus only                                           |
| `activity_log` global views        | No        | Manual refresh                                                  |

---

## 13. Testing strategy

| Level       | Tool                                           | Target                                                                                                                             |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                                         | Permission-resolution helpers, Zod schemas, pure utilities                                                                         |
| Component   | RTL                                            | Forms, permission-aware rendering, kanban card behaviour with mocked queries                                                       |
| Integration | Vitest + msw or in-memory Supabase mock        | Mutations + cache invalidation paths                                                                                               |
| E2E         | Playwright                                     | Per-phase happy-path scripts: login → create user → assign group → drag card → lock deal → see accounting → block client → unblock |
| RLS         | SQL test suite (Supabase pgtap or hand-rolled) | One test per (role, board, action, scope) combination — non-negotiable                                                             |

CI runs Vitest + Playwright against a fresh Supabase test project on every push.

---

## 14. Phase plan

### Phase 0 — Foundations (~1 week)

**Goal:** runnable empty-shell app with Supabase wired up and i18n initialised.

- Initialise Vite + React + TS + Tailwind + shadcn/ui starter.
- Configure ESLint + Prettier + strict tsconfig.
- Create Supabase project (dev). Generate types via `supabase gen types`.
- Implement `lib/supabase.ts`, `lib/queryClient.ts`, root `Providers`.
- Set up React Router with placeholder routes + auth guard.
- Set up react-i18next; create initial `en.json` and `el.json` namespaces (`common`, `auth`).
- App shell: sidebar (locale-aware nav), top bar with user menu, locale switcher.
- Vercel/Netlify/Cloudflare Pages deploy of an empty signed-in state.
- Vitest + Playwright wired up; one trivial test each to prove CI works.

**Acceptance:** open the app → see a localised empty layout in EN or EL; CI passes.

### Phase 1 — Auth + Users + Groups (~1 week)

- Migrations for `profiles`, `groups`, `user_groups`. Seed 6 groups.
- Login page (Supabase email/password). First-login redirect to set-password page.
- `useAuthStore` populated on login.
- `/admin/users` list page (TanStack Table).
- "Create user" dialog: full_name, email, temp password, group(s).
- "User detail" page: edit profile, manage groups, deactivate.
- RLS policies on `profiles`, `groups`, `user_groups` (admin-only mutate; self-read).

**Acceptance:** an admin can invite a user, that user can log in, change password, and is correctly placed in groups; non-admin users cannot access `/admin/*`.

### Phase 2 — Permissions engine + Admin UI (~1.5 weeks)

- Migrations for `group_permissions`, `user_permissions`, `field_permissions`, `pipeline_stages`.
- Seed pipeline_stages for all 6 boards as specified in 6.2.
- `user_effective_permissions` SQL view.
- `useEffectivePermission(board, action)` and `useFieldPermission(table, field)` hooks (cache from auth store, refresh on permission change events).
- Generic Postgres trigger for `activity_log` on permission tables.
- `/admin/groups` matrix UI (group × board × action × scope).
- `/admin/users/:id/permissions` UI: shows effective permissions, allows overrides.
- `/admin/fields` UI: define field-level rules per group/user.
- `/admin/stages` UI: configure stages per board (CRUD, reorder).
- Generic RLS policy template applied to a placeholder `clients` table to prove the pattern works.
- pgtap tests (or equivalent) covering at least one rule per role.

**Acceptance:** admin can configure permissions; effective view matches manual computation; field-level rules hide/readonly correctly in a test page.

### Phase 3 — Clients + Sales Kanban (~3–4 weeks)

- Migrations for `clients`, `deals`, `jobs` (skeleton — full job lifecycle wires in Phase 6), `comments`, `attachments`, `activity_log`, `notifications`, `saved_filters`.
- All RLS policies for the above using the engine from Phase 2.
- Generic activity-log trigger applied to `clients`, `deals`, `jobs`, `comments`, `attachments`.
- Sales kanban (`/sales/kanban`): @dnd-kit, optimistic updates, Realtime subscription, stage validation on Won.
- "Lock deal" RPC + validation (see 6.4); on success creates Accounting onboarding row (Phase 4 builds the kanban; Phase 3 just creates the data).
- Client form / Deal form (RHF + Zod).
- Client detail / Deal detail pages with tabs: Overview, Comments, Attachments, Activity, Jobs (read-only stub).
- Comments component with @mention parsing; notifications inserted on mention.
- Attachments uploader (Supabase Storage, 25 MB cap).
- Activity tab reads from `activity_log`.
- Notifications bell with Realtime feed.
- Saved-filters UI + per-user persistence.
- "My Clients" page for sales (`/sales/clients`).
- All UI strings translated EN + EL.
- Field-level rules honoured in client/deal forms and detail pages.

**Acceptance:** a Sales user can manage a deal end to end through the kanban, drop into Won (validated), and see the activity log + notifications; an admin can hide `expected_close_date` from a specific group/user and verify both UI and DB views (`deals_safe`) respect it; whole UI works in Greek.

### Phase 4 — Accounting onboarding kanban (Phase 4+ stub)

Builds `/accounting/onboarding` kanban; consumes the data the Sales lock action already creates. Stage definitions and `complete_accounting` RPC. Sales→Accounting handoff e2e tested.

### Phase 5 — Recurring billing + blocking (stub)

`monthly_invoices` + `monthly_invoice_items` + `client_blocks` migrations. `/accounting/recurring` table view. "Generate invoices for {month}" RPC. Daily overdue job. Block/unblock RPC + UI. Soft-block enforcement on tech kanbans.

### Phase 6 — Technical sub-departments × 4 (stub)

Sub-department kanbans; monthly task panel component; monthly reset job; cross-dept visibility "My Clients" pages for each tech group.

### Phase 7 — ClickUp integration (stub)

Pending user-supplied access. Likely: outbound webhook on key state changes; pull task status into job cards.

### Phase 8 — Polish & deferred features (stub)

Email infra + verification + email-based password reset; reports/dashboards; global search; document gen (PDFs); time tracking; client portal; 2FA; multi-currency; admin-configurable custom fields; presence indicators; activity-log diff viewer.

---

## 15. Risks & open questions

| #   | Risk / question                                                                                              | Mitigation                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| R1  | Field-level enforcement at DB level via security-definer views adds ~5–8 dev days; may slip Phase 3 schedule | Re-audit at end of Phase 2; if blocking, fall back to app-only enforcement and document the trust boundary |
| R2  | Greek translations require a fluent Greek speaker for review                                                 | Confirm with user who handles translation review                                                           |
| R3  | "Generate this month's invoices" is manual in MVP — risk of accountant forgetting                            | Add a clear dashboard prompt on accounting screens when period rolls over                                  |
| R4  | RLS performance on tables with many rows + complex permission joins                                          | Index `user_groups`, `group_permissions`; benchmark at end of Phase 2                                      |
| R5  | ClickUp API specifics unknown                                                                                | Defer detailed design until access granted                                                                 |
| R6  | Tech kanbans for recurring services may feel "static" since cards stay in `active` for months                | Monthly task panel is the dynamic surface; revisit after MVP usage data                                    |

---

## 16. Glossary

- **Board** — a kanban surface owned by one group (e.g., "sales", "accounting_onboarding", "web_seo").
- **Deal** — one sale event; has many jobs once locked.
- **Job** — one service delivered to a client; lives on a sub-department kanban; one_time or recurring_monthly.
- **Lock (deal)** — terminal sales action; freezes deal + creates accounting record.
- **Complete (accounting)** — terminal accounting onboarding action; spawns jobs into tech sub-boards.
- **Block (client)** — accounting action; soft-blocks `move_stage` across all the client's jobs.
- **Effective permission** — computed permission for a (user, board, action) tuple after merging group + user-override + admin-flag.
- **Group** — operational unit (sales / accounting / web_seo / local_seo / web_dev / social_media). "Technical" is a UI label, not a group.
