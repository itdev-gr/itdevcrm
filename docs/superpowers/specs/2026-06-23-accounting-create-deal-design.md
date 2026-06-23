# Accounting creates a new deal from the board — Design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Author:** Marios + Claude

## Problem

Today a deal can **only** be created by converting a won lead through the sales
pipeline (`convert_lead_to_client` RPC creates the client + deal + locks it).
There is no standalone "create deal" path, and the Accounting Onboarding board
(`/accounting/onboarding`) has no toolbar action for it.

Accounting needs to create deals that never went through sales: returning
customers buying more, off-platform / negotiated deals, and migrations. The deal
should land in the **New** column ready for the normal onboarding workflow
(accounting adds jobs and payments afterward, exactly as today).

## Decisions (from brainstorming Q&A)

1. **Client:** existing **or** new (create a client inline if not in the CRM).
2. **Scope:** deal **shell only** — no service jobs created in this dialog;
   accounting adds them afterward (current manual workflow).
3. **Permissions:** all **accounting** group members (plus admins).
4. **Validation:** **lightweight** — only client + title required; everything
   else optional and editable later.

## Architecture

One security-definer RPC does the atomic work; the frontend is a dialog +
mutation hook + a guarded button. No new tables.

```
"New Deal" button (PageHeader, capability-gated)
        │
        ▼
NewDealDialog ──validateNewDeal()──▶ useCreateAccountingDeal (mutation)
        │                                   │
        │                                   ▼
        │                       rpc accounting_create_deal  (security definer)
        │                                   │
        │                 ┌─────────────────┼─────────────────┐
        │                 ▼                 ▼                 ▼
        │         guard: admin OR    optional new       insert deal
        │         accounting_        client (own        (fresh code,
        │         onboarding.create  generated code)    accounting 'new')
        │                                   │
        ▼                                   ▼
  invalidate useAccountingDeals      returns { deal_id, code }
  + navigate to deal detail
```

## Components

### 1. RPC `accounting_create_deal` (security definer)

Mirrors `convert_lead_to_client`'s structure. Single atomic transaction.

**Signature (params):**

- `p_client_id uuid` — existing client, **or**
- `p_new_client jsonb` — `{ name (required), email?, phone?, company_name?,
  vat_number?, country? }` when creating a client inline
- `p_title text`
- `p_one_time numeric default 0`
- `p_monthly numeric default 0`
- `p_payment_method text default null` — `'cash' | 'online'` or null
- `p_description text default null`

**Permission guard (first statement):**

```sql
if not (public.current_user_is_admin()
        or public.current_user_can('accounting_onboarding','create')) then
  raise exception 'not_authorized';
end if;
```

Being `security definer`, the RPC bypasses the strict `deals_insert` RLS
(`admin OR sales.create`) that accounting members do not satisfy — the guard
above enforces access instead.

**Validation (lightweight):**

- Exactly one of `p_client_id` / `p_new_client` is provided (raise
  `missing_client` / `ambiguous_client`).
- `p_title` is non-empty after trim (raise `missing_title`).
- If `p_new_client`, its `name` is non-empty (raise `missing_client_name`).
- `p_one_time >= 0` and `p_monthly >= 0`.
- `p_payment_method` is null or in (`cash`, `online`) (raise
  `invalid_payment_method`).

**Work:**

1. If `p_new_client`: insert into `clients` (name + optional contact fields,
   `owner_user_id = null`, `code = lpad(nextval('public.lead_code_seq'),6,'0')`).
   Resolve `v_client_id`. Otherwise `v_client_id = p_client_id` (verify it
   exists, else raise `client_not_found`).
2. Look up stages:
   - `acc_new_stage_id` = `pipeline_stages` where `board='accounting_onboarding'
     and code='new'`.
   - `won_stage_id` = `pipeline_stages` where `board='sales' and code='won'`.
3. Insert the deal with a **fresh deal code** (own `nextval` — a deal gets its
   own code distinct from the client's, since a client can have many deals).

**Deal field defaults:**

| Column | Value | Rationale |
|---|---|---|
| `client_id` | resolved client | — |
| `title` | `p_title` (trimmed) | required |
| `description` | `p_description` | optional |
| `one_time_value` | `p_one_time` | default 0 |
| `recurring_monthly_value` | `p_monthly` | default 0 |
| `payment_method` | `p_payment_method` | optional |
| `currency` | `'EUR'` | project default |
| `code` | `lpad(nextval('public.lead_code_seq'),6,'0')` | copyable/searchable like every deal |
| `stage_id` | sales **won** | keeps it off the active *sales* board (not a sales lead) |
| `accounting_stage_id` | accounting **new** | lands in New column |
| `owner_user_id` | `null` | accounting assigns later (same as conversion) |
| `won_by_user_id` | `null` | no sales rep to attribute |
| `locked_at` / `locked_by` | `now()` / `auth.uid()` | finalized; no sales editing |
| `actual_close_date` | `current_date` | created now |
| `invoiced_date` | `null` | editable via existing cell; avoids wrong financials |
| `archived` | `false` | — |

**Deliberately NOT created:** no lead row (keeps the sales pipeline clean — the
470-lead historical backfill was a one-time reporting fix), no jobs (deal shell
only).

**Returns:** `json { deal_id, code }`.

### 2. Permission seed migration

Add `accounting_onboarding.create` (scope `all`, `allowed=true`) to the
**accounting** group:

```sql
insert into public.group_permissions (group_id, board, action, scope, allowed)
select id, 'accounting_onboarding', 'create', 'all', true
from public.groups where code = 'accounting'
on conflict (group_id, board, action) do nothing;
```

Admins are always allowed via `current_user_is_admin()` and need no seed.

### 3. Frontend

- **"New Deal" button** in `AccountingOnboardingKanbanPage`'s `PageHeader`
  `children`, rendered only when `can('accounting_onboarding','create') ||
  isAdmin` (reuse the existing permission hook). Greek label "Νέα Συμφωνία".
- **`NewDealDialog`** (existing dialog patterns):
  - **Client** section: search-select existing clients **or** a "New client"
    toggle revealing a required name field (+ optional email / phone / company).
  - **Title** (required; prefilled `"<client> deal"` once a client is chosen).
  - **One-time €** (optional), **Monthly €** (optional).
  - **Payment method** (optional select: Cash / Online).
  - **Notes** (optional → `description`).
  - Submit → `useCreateAccountingDeal`; on success: toast, invalidate
    `useAccountingDeals` so the card appears in **New**, then navigate to the new
    deal's detail page.
- **`useCreateAccountingDeal`** mutation hook wrapping the RPC. Capture
  `from`/`rpc` with `.bind(supabase)` (known detached-`this` gotcha) and use the
  existing `captureMutation` Sentry pattern.
- **`validateNewDeal(input)`** pure function mirroring the backend rules
  (client present, title non-empty, amounts ≥ 0, payment enum) — unit-tested
  first per TDD.
- **i18n:** Greek strings added to the accounting namespace.

## Data flow

1. User clicks **New Deal** → dialog opens.
2. User picks/creates a client, fills title (+ optional fields).
3. `validateNewDeal` gates submit.
4. `useCreateAccountingDeal` → `accounting_create_deal` RPC.
5. RPC guards permission, optionally creates the client, inserts the deal with a
   generated code in the accounting **New** stage, returns `{ deal_id, code }`.
6. Frontend invalidates `useAccountingDeals` (card appears) and navigates to the
   deal detail page.

## Error handling

- RPC raises explicit, named exceptions (`not_authorized`, `missing_client`,
  `missing_title`, `missing_client_name`, `invalid_payment_method`,
  `client_not_found`). The hook maps them to a user-facing toast; Sentry
  captures via `captureMutation`.
- The button is hidden without the capability; the RPC re-checks server-side, so
  hiding the button is convenience, not the security boundary.

## Testing (TDD, commit per task)

- **Unit:** `validateNewDeal` — required client, required title, amount ≥ 0,
  payment enum. Tests written first.
- **Unit:** form → RPC param builder (existing-vs-new-client branches).
- **RPC verification (live, role-switch technique):** create a deal for an
  existing client and for a new client; confirm code generated + lands in
  accounting `new`; confirm a non-accounting / non-admin user is denied.
- **Build:** `npm run build` (strict: `tsc -b` + `eslint --max-warnings=0`)
  green. Assert valid array indices with `!`.
- **Smoke:** in the running app, create one existing-client and one new-client
  deal; confirm the card shows in **New** with a copyable code; open its detail
  page.

## Changes / Revert

| Change | Revert |
|---|---|
| Migration A — seed `accounting_onboarding.create` for accounting group | `delete from group_permissions where board='accounting_onboarding' and action='create'` (rollback SQL embedded in migration) |
| Migration B — `create or replace function accounting_create_deal(...)` | `drop function if exists public.accounting_create_deal(...)` (embedded) |
| Frontend — `NewDealDialog`, `useCreateAccountingDeal`, `validateNewDeal` (+ tests), guarded button, i18n | revert the commit(s) |

Atomic commits per task; rollback SQL embedded in each migration's comment
block per project convention.

## Out of scope (edit-later, deliberately dropped from the create form)

- Creating service jobs (deal shell only).
- Setting `owner_user_id`, `invoiced_date`, contract attachment at create time —
  all editable on the deal afterward.
- Creating a corresponding sales lead.
