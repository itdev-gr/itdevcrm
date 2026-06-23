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
5. **Matching Won lead:** the RPC also creates a converted ("won") lead linked to
   the deal, so future lead-intake dedup catches the same customer on the lead
   side (not only via the deal-client match). This mirrors the normal
   conversion flow and the one-time won-leads backfill.

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
        │      ┌──────────────┬──────────────┬──────────────┬──────────────┐
        │      ▼              ▼              ▼              ▼              ▼
        │  guard: admin   one shared    optional new   insert deal   insert won
        │  OR accounting_ code via      client         (shared code, lead (source
        │  onboarding.    nextval       (shared code)  accounting     ='import',
        │  create         (lead+deal+                  'new')         converted,
        │                  new client)                                linked to
        │                                   │                         deal+client)
        ▼                                   ▼
  invalidate useAccountingDeals      returns { deal_id, code }
  + navigate to deal detail
```

All inserts happen in one atomic transaction. The won lead is created **last**,
after the deal/client ids exist, and links back via `converted_deal_id` /
`converted_client_id`.

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

1. Generate **one shared code** up front: `v_code =
   lpad(nextval('public.lead_code_seq'),6,'0')`. The deal and the won lead share
   it (and a brand-new client too), exactly as the normal conversion flow makes
   lead/client/deal share a code. (`leads.code` is `UNIQUE` — a fresh sequence
   value guarantees no collision.)
2. If `p_new_client`: insert into `clients` (name + optional contact fields,
   `owner_user_id = null`, `code = v_code`). Resolve `v_client_id`. Otherwise
   `v_client_id = p_client_id` (verify it exists, else raise `client_not_found`);
   an existing client keeps its own code.
3. Look up stages:
   - `acc_new_stage_id` = `pipeline_stages` where `board='accounting_onboarding'
     and code='new'`.
   - `won_stage_id` = `pipeline_stages` where `board='sales' and code='won'`.
4. Insert the deal with `code = v_code`.
5. Insert the matching **won lead** (see its own field table below), linking
   `converted_deal_id = v_deal_id`, `converted_client_id = v_client_id`.

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
| `code` | `v_code` (shared) | copyable/searchable; same code as its won lead |
| `stage_id` | sales **won** | keeps it off the active *sales* board (not a sales lead) |
| `accounting_stage_id` | accounting **new** | lands in New column |
| `owner_user_id` | `null` | accounting assigns later (same as conversion) |
| `won_by_user_id` | `null` | no sales rep to attribute |
| `locked_at` / `locked_by` | `now()` / `auth.uid()` | finalized; no sales editing |
| `actual_close_date` | `current_date` | created now |
| `invoiced_date` | `null` | editable via existing cell; avoids wrong financials |
| `archived` | `false` | — |

**Deliberately NOT created:** no jobs (deal shell only — accounting adds them
afterward).

**Won lead field defaults** (mirrors the 2026-06-23 won-leads backfill —
migration `20260623120000_backfill_won_leads_from_deals.sql`):

| Column | Value | Rationale |
|---|---|---|
| `source` | `'import'` | **no `lead_welcome` email** on insert (only `manual`/`meta` send) |
| `automations_enabled` | `false` | belt-and-braces: no `won_welcome`/`won_next_steps` even if the lead is ever updated later |
| `title` | `p_title` (or client name) | display name |
| `code` | `v_code` (shared) | same code as the deal |
| `stage_id` | sales **won** | `won` has no `restricted_to_user_id`, so the stage-restriction trigger is a no-op |
| `converted_at` | `now()` | marks it converted → **filtered out of the active sales kanban** (`converted_at IS NULL` excludes it) |
| `converted_deal_id` | `v_deal_id` | links to the new deal |
| `converted_client_id` | `v_client_id` | links to the client |
| `owner_user_id` | `auth.uid()` (creator) | **must be non-NULL** — the round-robin trigger only fires when owner is NULL; this avoids auto-distributing a converted lead to a random rep |
| `won_by_user_id` | `null` | no sales rep to attribute (matches the deal) |
| `company_name`, `email`, `phone`, `address`, `vat_number`, `country`, `industry`, `website` | from the client (existing or the new-client payload) | **`phone` populated → `phone_normalized` auto-stamps** (GENERATED column) so intake dedup matches by phone/email |
| `estimated_one_time_value` / `estimated_monthly_value` | `p_one_time` / `p_monthly` | mirror the deal |
| `services_planned` | `'[]'` | deal shell has no services |
| `archived` | `false` | — |

`phone_normalized` is **GENERATED ALWAYS** — never inserted directly; it
auto-computes from `phone`.

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
   generated code in the accounting **New** stage, then inserts the linked won
   lead, and returns `{ deal_id, code }`.
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
- **Won-lead verification:** the linked won lead exists with the same `code`,
  `source='import'`, `converted_deal_id` set, `phone_normalized` populated; it
  does **not** appear on the active sales kanban; **no welcome/won email is
  enqueued** (check `email_log` / queue); the lead owner is non-NULL (no
  round-robin assignment fired); and a subsequent lead-intake of the same
  phone/email is flagged as a duplicate against it.
- **Build:** `npm run build` (strict: `tsc -b` + `eslint --max-warnings=0`)
  green. Assert valid array indices with `!`.
- **Smoke:** in the running app, create one existing-client and one new-client
  deal; confirm the card shows in **New** with a copyable code; open its detail
  page.

## Changes / Revert

| Change | Revert |
|---|---|
| Migration A — seed `accounting_onboarding.create` for accounting group | `delete from group_permissions where board='accounting_onboarding' and action='create'` (rollback SQL embedded in migration) |
| Migration B — `create or replace function accounting_create_deal(...)` (creates deal **and** linked won lead) | `drop function if exists public.accounting_create_deal(...)` (embedded). Already-created won leads stay — they are harmless converted records; remove via `delete from leads where converted_deal_id = '<id>'` if ever needed. |
| Frontend — `NewDealDialog`, `useCreateAccountingDeal`, `validateNewDeal` (+ tests), guarded button, i18n | revert the commit(s) |

Atomic commits per task; rollback SQL embedded in each migration's comment
block per project convention.

## Out of scope (edit-later, deliberately dropped from the create form)

- Creating service jobs (deal shell only).
- Setting `owner_user_id`, `invoiced_date`, contract attachment at create time —
  all editable on the deal afterward.
- The won lead is a hidden dedup/record entity (converted, off the active
  kanban); it is **not** surfaced as an editable lead in this flow.
