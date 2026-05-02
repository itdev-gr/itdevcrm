# Leads Pipeline + Accounting Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "create-client-then-create-deal" entry point with a `leads` table that drives the Sales kanban. Leads carry minimal info (name + one contact + source) at intake; sales person enriches them as they move through stages. Reaching the `won` column triggers `convert_lead_to_client` RPC, which validates the data, creates a `clients` row + `deals` row, locks the deal, and hands off to Accounting Onboarding. Disqualified leads stay as leads forever. Also clean up unused recurring-billing UI/tables since the agency uses an external invoicing system.

**Architecture:** New `leads` table with all the fields a sales person fills in over time. Sales kanban (`/sales/kanban`) swaps its data source from `deals` to `leads` — same stages, same drag-drop UX. Drop on `won` calls a new server-side RPC that creates a client + deal + locks the deal in one transaction. Disqualified leads (`not_interested`, `dead_end`) stay archived in the leads table; never become clients. Recurring-billing UI removed, but `client_blocks` stays — block-client is still the mechanism to halt tech work when the external invoicer flags non-payment.

**Tech Stack:** All from Phases 0–5 (no new tools).

**Reference spec:** `docs/superpowers/specs/2026-05-01-itdevcrm-design.md` (covers the underlying domain). This plan supersedes the "create-client-then-deal" flow described there.

**Branch:** `main` (push directly per project memory).

---

## Sub-phase grouping

```
A. Schema (Tasks 1–3)            leads table, convert RPC, drop invoice tables, types
B. Lead data layer (Tasks 4–5)   queryKeys, rpc wrappers, hooks, i18n
C. Lead UI (Tasks 6–8)           CreateLeadDialog, LeadForm, LeadDetailPage
D. Sales kanban swap (Tasks 9–10) replace deal data with leads; won-drop conversion
E. Cleanup (Tasks 11–12)         remove "+ Add deal" UI; delete /accounting/recurring + billing/
F. Acceptance (Task 13)          e2e smoke + manual pass
```

---

## File Structure (after this plan)

```
.
├── supabase/
│   └── migrations/
│       ├── 20260502000017_leads_table.sql               # leads + RLS + triggers
│       ├── 20260502000018_convert_lead_rpc.sql          # convert_lead_to_client
│       └── 20260502000019_drop_recurring_billing.sql    # drop invoice tables/RPCs/cron
├── src/
│   ├── lib/
│   │   ├── queryKeys.ts                                 # MODIFY: leads, lead
│   │   └── rpc.ts                                       # MODIFY: convertLeadToClient; remove generateMonthlyInvoices
│   ├── features/
│   │   ├── leads/                                       # NEW
│   │   │   ├── hooks/
│   │   │   │   ├── useLeads.ts
│   │   │   │   ├── useLead.ts
│   │   │   │   ├── useCreateLead.ts
│   │   │   │   ├── useUpdateLead.ts
│   │   │   │   ├── useArchiveLead.ts
│   │   │   │   ├── useMoveLeadStage.ts
│   │   │   │   └── useConvertLead.ts
│   │   │   ├── CreateLeadDialog.tsx
│   │   │   ├── LeadForm.tsx
│   │   │   └── LeadDetailPage.tsx
│   │   ├── sales/
│   │   │   ├── SalesKanbanPage.tsx                      # MODIFY: leads data source + won converts
│   │   │   ├── SalesKanbanColumn.tsx                    # MODIFY: leads prop type
│   │   │   ├── SalesKanbanCard.tsx                      # MODIFY: lead-shaped card
│   │   │   └── useSalesKanbanRealtime.ts                # MODIFY: subscribe to leads channel
│   │   ├── billing/                                     # DELETED
│   │   ├── client_blocks/                               # KEEP (still useful)
│   │   ├── clients/
│   │   │   └── ClientDetailPage.tsx                     # MODIFY: remove "+ New Deal" button
│   │   └── deals/
│   │       ├── CreateDealDialog.tsx                     # DELETED (deals only via conversion)
│   │       ├── DealForm.tsx                             # DELETED (deals not user-edited at create)
│   │       └── hooks/useUpsertDeal.ts                   # DELETED (no manual deal create)
│   ├── components/layout/Sidebar.tsx                    # MODIFY: remove Recurring link
│   ├── app/router.tsx                                   # MODIFY: /leads/:leadId; remove /accounting/recurring
│   └── i18n/locales/{en,el}/leads.json                  # NEW
└── tests/
    └── leads-smoke.spec.ts                               # NEW
```

---

## Conventions

- Every task ends in commit + push to `main`.
- **REQUIRED gate verification protocol**: each subagent runs `npm run format:check && npm run lint && npm run typecheck && npm run test:run` as a single chained command; commit only if `exit: 0`. Auto-fix with `npm run format` if needed.
- Migration env vars `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` already in shell.
- Regenerate types after every migration: `npm run types:gen`.

---

# Sub-phase A — Schema (Tasks 1–3)

## Task 1 — Migration: leads table

**Files:**
- Create: `supabase/migrations/20260502000017_leads_table.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Leads pipeline migration: leads table + RLS + triggers
-- =============================================================================
create table public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Source
  source text not null check (source in ('meta', 'manual', 'import')),
  source_data jsonb,

  -- Card display
  title text not null,

  -- Contact + company info (filled in over time)
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  company_name text,
  industry text,
  country text,
  address text,
  vat_number text,
  notes text,

  -- Estimated values (become deals.* after conversion)
  estimated_one_time_value numeric(12,2) not null default 0,
  estimated_monthly_value numeric(12,2) not null default 0,
  services_planned jsonb not null default '[]'::jsonb,
  expected_close_date date,

  -- Pipeline
  stage_id uuid references public.pipeline_stages(id),
  owner_user_id uuid references public.profiles(user_id),

  -- Conversion (filled when lead reaches `won` and convert_lead_to_client succeeds)
  converted_at timestamptz,
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_deal_id uuid references public.deals(id) on delete set null,

  -- Soft delete + meta
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id)
);

create index leads_stage on public.leads (stage_id) where archived = false and converted_at is null;
create index leads_owner on public.leads (owner_user_id) where archived = false;
create index leads_source on public.leads (source);
create index leads_converted on public.leads (converted_at desc) where converted_at is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger leads_activity
  after insert or update or delete on public.leads
  for each row execute function public.log_activity('id');

alter table public.leads enable row level security;

create policy leads_select
  on public.leads for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or owner_user_id = auth.uid()
  );

create policy leads_insert
  on public.leads for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
  );

create policy leads_update
  on public.leads for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or (converted_at is null and public.current_user_can('sales', 'move_stage'))
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('sales', 'move_stage')
  );

create policy leads_delete
  on public.leads for delete
  to authenticated
  using (public.current_user_is_admin());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000017_leads_table.sql
git commit -m "feat(db): leads table + RLS + activity log trigger"
git push origin main
```

---

## Task 2 — Migration: convert_lead_to_client RPC

**Files:**
- Create: `supabase/migrations/20260502000018_convert_lead_rpc.sql`

The RPC validates the lead has the same data the existing `lock_deal` validation requires (email + phone/address + at least one service + contract attachment), then creates a `clients` row, creates a `deals` row, locks it, reassigns lead-attached comments + attachments to the new deal, and marks the lead `converted_at`.

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Leads pipeline migration: convert_lead_to_client RPC
-- =============================================================================
create or replace function public.convert_lead_to_client(target_lead_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l record;
  errors text[] := '{}';
  contract_count int;
  service_count int;
  won_stage_id uuid;
  acc_new_stage_id uuid;
  new_client_id uuid;
  new_deal_id uuid;
  full_name text;
begin
  -- Permission: sales lock_deal OR admin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into l from public.leads where id = target_lead_id;
  if l is null then
    return jsonb_build_object('ok', false, 'errors', array['lead_not_found']);
  end if;
  if l.converted_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_converted']);
  end if;
  if l.archived then
    return jsonb_build_object('ok', false, 'errors', array['lead_archived']);
  end if;

  -- Validate the same conditions lock_deal validates today
  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := errors || 'value_required';
  end if;

  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then
    errors := errors || 'at_least_one_service_required';
  end if;

  if l.email is null or l.email = '' then
    errors := errors || 'email_required';
  end if;

  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := errors || 'phone_or_address_required';
  end if;

  if l.company_name is null or trim(l.company_name) = '' then
    errors := errors || 'company_name_required';
  end if;

  -- Contract attachment must exist on the lead
  select count(*) into contract_count
  from public.attachments
  where parent_type = 'lead' and parent_id = l.id and kind = 'contract' and archived = false;
  if contract_count = 0 then
    errors := errors || 'contract_attachment_required';
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- 1. Create client row
  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, notes, assigned_owner_id, created_by
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.notes, l.owner_user_id, auth.uid()
  ) returning id into new_client_id;

  -- 2. Resolve stage IDs
  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  -- 3. Create deal row, already locked at won
  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by,
    created_by
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.owner_user_id,
    l.estimated_one_time_value,
    l.estimated_monthly_value,
    l.services_planned,
    l.expected_close_date,
    current_date,
    coalesce(won_stage_id, l.stage_id),
    acc_new_stage_id,
    now(),
    auth.uid(),
    auth.uid()
  ) returning id into new_deal_id;

  -- 4. Reassign collaboration entities (comments + attachments) from lead → deal
  update public.comments
    set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;

  update public.attachments
    set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;

  -- 5. Mark lead converted
  update public.leads
    set
      converted_at = now(),
      converted_client_id = new_client_id,
      converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id)
    where id = l.id;

  -- 6. Owner notification (uses Phase 3 notifications table)
  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      l.owner_user_id,
      'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'lead_id', l.id,
    'client_id', new_client_id,
    'deal_id', new_deal_id
  );
end $$;

grant execute on function public.convert_lead_to_client(uuid) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000018_convert_lead_rpc.sql
git commit -m "feat(db): convert_lead_to_client RPC (validate + create client+deal+lock+reassign collab)"
git push origin main
```

---

## Task 3 — Migration: drop recurring billing + apply all + types

**Files:**
- Create: `supabase/migrations/20260502000019_drop_recurring_billing.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Drop unused recurring-billing infra (external invoicer handles this).
-- client_blocks STAYS — block-client is still our mechanism to halt tech work.
-- =============================================================================

-- Stop the daily cron job first
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('daily_mark_overdue_invoices');
  end if;
exception when others then
  -- if already unscheduled, ignore
  null;
end $$;

-- Drop RPCs
drop function if exists public.generate_monthly_invoices(text);
drop function if exists public.mark_overdue_invoices();

-- Drop tables (FK from items to invoices is `on delete cascade`)
drop table if exists public.monthly_invoice_items;
drop table if exists public.monthly_invoices;
```

- [ ] **Step 2: Apply all 3 migrations**

```bash
echo y | npx -y supabase@latest db push 2>&1 | tail -10
```

- [ ] **Step 3: Verify endpoints**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')
echo "leads:"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" "${URL}/rest/v1/leads?select=*&limit=1" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
echo "convert_lead_to_client RPC:"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" -X POST "${URL}/rest/v1/rpc/convert_lead_to_client" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -H "Content-Type: application/json" -d '{"target_lead_id":"00000000-0000-0000-0000-000000000000"}'
echo "monthly_invoices (expect 404):"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" "${URL}/rest/v1/monthly_invoices?select=*&limit=1" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
```

Expect: `leads HTTP 200`, `convert_lead_to_client HTTP 200`, `monthly_invoices HTTP 404`.

- [ ] **Step 4: Regen types + gates**

```bash
npm run types:gen
npm run format:check && npm run lint && npm run typecheck && npm run test:run
```

Note: typecheck WILL fail at this point because `src/features/billing/*` references the removed Database types. That's expected — Tasks 11–12 remove the billing UI. To unblock typecheck temporarily, also run this single command before committing this task:

```bash
git rm -r src/features/billing
```

Re-run the gate chain. With billing/ gone + `monthly_invoices` types gone from `src/types/supabase.ts`, typecheck passes.

Also remove the `BILLING` references from `src/components/layout/Sidebar.tsx` (the recurring link added in Phase 5):

```tsx
// REMOVE this NavLink (the one pointing at /accounting/recurring)
<NavLink to="/accounting/recurring" ...>
  {t('accounting:recurring.title')}
</NavLink>
```

And the route in `src/app/router.tsx`:

```tsx
// REMOVE the import
import { AccountingRecurringPage } from '@/features/billing/AccountingRecurringPage';

// CHANGE
{
  path: 'accounting',
  children: [
    { path: 'onboarding', element: <AccountingOnboardingKanbanPage /> },
    { path: 'recurring', element: <AccountingRecurringPage /> }, // REMOVE this line
  ],
},
```

Re-run gates one more time — exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): drop recurring billing tables/RPCs/cron; remove /accounting/recurring UI"
git push origin main
```

---

# Sub-phase B — Lead data layer (Tasks 4–5)

## Task 4 — queryKeys + RPC wrapper + i18n

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/lib/rpc.ts`
- Create: `src/i18n/locales/en/leads.json`
- Create: `src/i18n/locales/el/leads.json`

- [ ] **Step 1: queryKeys**

Add to the `queryKeys` object (after `accountingDeals`):

```ts
leads: (filters?: Record<string, string | undefined>) => ['leads', filters ?? null] as const,
lead: (id: string) => ['lead', id] as const,
```

**Also REMOVE the now-unused keys:**
```ts
monthlyInvoices: (...) => ...,    // delete
monthlyInvoice: (...) => ...,     // delete
```

- [ ] **Step 2: RPC wrapper**

Append to `src/lib/rpc.ts`:

```ts
export type ConvertLeadResult =
  | { ok: true; lead_id: string; client_id: string; deal_id: string }
  | { ok: false; errors: string[] };

export async function convertLeadToClient(leadId: string): Promise<ConvertLeadResult> {
  const { data, error } = await supabase.rpc('convert_lead_to_client', {
    target_lead_id: leadId,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as ConvertLeadResult;
}
```

**Also REMOVE these unused exports** from `src/lib/rpc.ts`:
```ts
export type GenerateInvoicesResult ...     // delete
export async function generateMonthlyInvoices(...) ...   // delete
```

- [ ] **Step 3: i18n leads namespace EN**

Create `src/i18n/locales/en/leads.json`:

```json
{
  "title": "Leads",
  "new_lead": "New lead",
  "actions": {
    "create": "Add lead",
    "save": "Save",
    "cancel": "Cancel",
    "archive": "Archive",
    "convert": "Convert to client"
  },
  "form": {
    "source": "Source",
    "source_options": {
      "manual": "Manual",
      "meta": "Meta (Facebook/Instagram)",
      "import": "Import"
    },
    "title": "Lead title",
    "contact_first_name": "First name",
    "contact_last_name": "Last name",
    "email": "Email",
    "phone": "Phone",
    "company_name": "Company name",
    "industry": "Industry",
    "country": "Country",
    "address": "Address",
    "vat_number": "VAT number",
    "notes": "Notes",
    "estimated_one_time_value": "One-time value (€)",
    "estimated_monthly_value": "Monthly value (€)",
    "services_planned": "Services planned",
    "expected_close_date": "Expected close date"
  },
  "tabs": {
    "overview": "Overview",
    "comments": "Comments",
    "attachments": "Attachments",
    "activity": "Activity"
  },
  "convert": {
    "errors": {
      "permission_denied": "You do not have permission to convert leads.",
      "lead_not_found": "Lead not found.",
      "already_converted": "This lead is already converted.",
      "lead_archived": "Cannot convert an archived lead.",
      "value_required": "At least one of one-time or monthly value must be greater than 0.",
      "at_least_one_service_required": "Add at least one service.",
      "email_required": "Email is required.",
      "phone_or_address_required": "Phone or address is required.",
      "company_name_required": "Company name is required.",
      "contract_attachment_required": "A signed contract attachment is required."
    }
  },
  "card": {
    "monthly": "/mo",
    "no_company": "(no company yet)"
  },
  "empty": "No leads yet. Click \"Add lead\" to create one."
}
```

- [ ] **Step 4: i18n leads namespace EL**

Create `src/i18n/locales/el/leads.json`:

```json
{
  "title": "Επαφές (Leads)",
  "new_lead": "Νέα επαφή",
  "actions": {
    "create": "Προσθήκη επαφής",
    "save": "Αποθήκευση",
    "cancel": "Άκυρο",
    "archive": "Αρχειοθέτηση",
    "convert": "Μετατροπή σε πελάτη"
  },
  "form": {
    "source": "Πηγή",
    "source_options": {
      "manual": "Χειροκίνητα",
      "meta": "Meta (Facebook/Instagram)",
      "import": "Εισαγωγή"
    },
    "title": "Τίτλος επαφής",
    "contact_first_name": "Όνομα",
    "contact_last_name": "Επώνυμο",
    "email": "Email",
    "phone": "Τηλέφωνο",
    "company_name": "Επωνυμία εταιρείας",
    "industry": "Κλάδος",
    "country": "Χώρα",
    "address": "Διεύθυνση",
    "vat_number": "ΑΦΜ",
    "notes": "Σημειώσεις",
    "estimated_one_time_value": "Εφάπαξ ποσό (€)",
    "estimated_monthly_value": "Μηνιαίο ποσό (€)",
    "services_planned": "Προγραμματισμένες υπηρεσίες",
    "expected_close_date": "Προβλεπόμενη ημερομηνία κλεισίματος"
  },
  "tabs": {
    "overview": "Επισκόπηση",
    "comments": "Σχόλια",
    "attachments": "Συνημμένα",
    "activity": "Ιστορικό"
  },
  "convert": {
    "errors": {
      "permission_denied": "Δεν έχετε δικαίωμα μετατροπής επαφών.",
      "lead_not_found": "Δεν βρέθηκε η επαφή.",
      "already_converted": "Η επαφή έχει ήδη μετατραπεί.",
      "lead_archived": "Δεν μπορεί να μετατραπεί αρχειοθετημένη επαφή.",
      "value_required": "Τουλάχιστον ένα από εφάπαξ ή μηνιαίο ποσό πρέπει να είναι μεγαλύτερο του 0.",
      "at_least_one_service_required": "Προσθέστε τουλάχιστον μία υπηρεσία.",
      "email_required": "Απαιτείται email.",
      "phone_or_address_required": "Απαιτείται τηλέφωνο ή διεύθυνση.",
      "company_name_required": "Απαιτείται επωνυμία εταιρείας.",
      "contract_attachment_required": "Απαιτείται υπογεγραμμένη σύμβαση ως συνημμένο."
    }
  },
  "card": {
    "monthly": "/μήνα",
    "no_company": "(χωρίς εταιρεία)"
  },
  "empty": "Καμία επαφή ακόμα. Πατήστε «Προσθήκη επαφής» για να δημιουργήσετε."
}
```

- [ ] **Step 5: Register namespace**

Read `src/i18n/index.ts` (or `src/i18n.ts`, whichever exists). Add `'leads'` to the namespaces list. Example:

```ts
ns: ['common', 'auth', 'users', 'admin', 'clients', 'deals', 'sales', 'accounting', 'leads'],
```

And import the resource files alongside the others:

```ts
import enLeads from './locales/en/leads.json';
import elLeads from './locales/el/leads.json';
// ...
resources: {
  en: { ..., leads: enLeads },
  el: { ..., leads: elLeads },
},
```

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(leads): queryKeys + convert_lead_to_client RPC wrapper + i18n EN/EL"
git push origin main
```

---

## Task 5 — Lead hooks

**Files:**
- Create: `src/features/leads/hooks/useLeads.ts`
- Create: `src/features/leads/hooks/useLead.ts`
- Create: `src/features/leads/hooks/useCreateLead.ts`
- Create: `src/features/leads/hooks/useUpdateLead.ts`
- Create: `src/features/leads/hooks/useArchiveLead.ts`
- Create: `src/features/leads/hooks/useMoveLeadStage.ts`
- Create: `src/features/leads/hooks/useConvertLead.ts`

- [ ] **Step 1: useLeads (list)**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type LeadRow = Database['public']['Tables']['leads']['Row'] & {
  stage?: { id: string; code: string; board: string; display_names: unknown } | null;
};

export type LeadsFilter = {
  ownerId?: string;
  stageId?: string;
  source?: 'meta' | 'manual' | 'import';
  includeConverted?: boolean;
};

export function useLeads(filter: LeadsFilter = {}) {
  return useQuery({
    queryKey: queryKeys.leads(filter as Record<string, string | undefined>),
    queryFn: async (): Promise<LeadRow[]> => {
      let q = supabase
        .from('leads')
        .select('*, stage:pipeline_stages(id, code, board, display_names)')
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (!filter.includeConverted) q = q.is('converted_at', null);
      if (filter.ownerId) q = q.eq('owner_user_id', filter.ownerId);
      if (filter.stageId) q = q.eq('stage_id', filter.stageId);
      if (filter.source) q = q.eq('source', filter.source);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LeadRow[];
    },
  });
}
```

- [ ] **Step 2: useLead (detail)**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { LeadRow } from './useLeads';

export function useLead(leadId: string) {
  return useQuery({
    queryKey: queryKeys.lead(leadId),
    queryFn: async (): Promise<LeadRow> => {
      const { data, error } = await supabase
        .from('leads')
        .select('*, stage:pipeline_stages(id, code, board, display_names)')
        .eq('id', leadId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as unknown as LeadRow;
    },
    enabled: !!leadId,
  });
}
```

- [ ] **Step 3: useCreateLead + useUpdateLead**

```ts
// useCreateLead.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { Database } from '@/types/supabase';

type LeadInsert = Database['public']['Tables']['leads']['Insert'];

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<LeadInsert, 'created_by' | 'owner_user_id'> & { owner_user_id?: string },
    ): Promise<string> => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const { data, error } = await supabase
        .from('leads')
        .insert({
          ...input,
          created_by: userId,
          owner_user_id: input.owner_user_id ?? userId,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'create_failed');
      return data.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
```

```ts
// useUpdateLead.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: LeadUpdate }) => {
      const { error } = await supabase.from('leads').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.lead(vars.id) });
    },
  });
}
```

- [ ] **Step 4: useArchiveLead + useMoveLeadStage**

```ts
// useArchiveLead.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

export function useArchiveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const { error } = await supabase
        .from('leads')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId,
          archived_reason: reason ?? null,
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
```

```ts
// useMoveLeadStage.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useMoveLeadStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, stageId }: { leadId: string; stageId: string }) => {
      const { error } = await supabase.from('leads').update({ stage_id: stageId }).eq('id', leadId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.lead(vars.leadId) });
    },
  });
}
```

- [ ] **Step 5: useConvertLead**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { convertLeadToClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const result = await convertLeadToClient(leadId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'convert_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return { leadId: result.lead_id, clientId: result.client_id, dealId: result.deal_id };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    },
  });
}
```

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/leads/
git commit -m "feat(leads): TanStack Query hooks for list/detail/create/update/archive/move/convert"
git push origin main
```

---

# Sub-phase C — Lead UI (Tasks 6–8)

## Task 6 — CreateLeadDialog

**Files:**
- Create: `src/features/leads/CreateLeadDialog.tsx`

A minimal create form: source, title, contact name, **one of** email/phone, company name. The full edit form lives on the detail page.

- [ ] **Step 1: Component**

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateLead } from './hooks/useCreateLead';

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function CreateLeadDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('leads');
  const create = useCreateLead();
  const navigate = useNavigate();

  const [source, setSource] = useState<'manual' | 'meta' | 'import'>('manual');
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');

  const canSubmit =
    title.trim().length > 0 && (email.trim().length > 0 || phone.trim().length > 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const id = await create.mutateAsync({
        source,
        title: title.trim(),
        contact_first_name: firstName.trim() || null,
        contact_last_name: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        company_name: company.trim() || null,
      });
      onOpenChange(false);
      navigate(`/leads/${id}`);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('new_lead')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="source">{t('form.source')}</Label>
            <select
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value as 'manual' | 'meta' | 'import')}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="manual">{t('form.source_options.manual')}</option>
              <option value="meta">{t('form.source_options.meta')}</option>
              <option value="import">{t('form.source_options.import')}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="title">{t('form.title')}</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fn">{t('form.contact_first_name')}</Label>
              <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ln">{t('form.contact_last_name')}</Label>
              <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="email">{t('form.email')}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="phone">{t('form.phone')}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="co">{t('form.company_name')}</Label>
            <Input id="co" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {t('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/leads/CreateLeadDialog.tsx
git commit -m "feat(leads): CreateLeadDialog (minimal-info form, navigates to detail)"
git push origin main
```

---

## Task 7 — LeadForm (full edit form)

**Files:**
- Create: `src/features/leads/LeadForm.tsx`

Reuses `ServicesPlannedField` (Phase 4 component) for services. Wraps `useUpdateLead`. Read-only when `lead.converted_at` is set.

- [ ] **Step 1: Component**

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ServicesPlannedField } from '@/features/deals/ServicesPlannedField';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';

type ServicesPlanned = LeadRow['services_planned'];

export function LeadForm({ lead }: { lead: LeadRow }) {
  const { t } = useTranslation('leads');
  const update = useUpdateLead();
  const readOnly = !!lead.converted_at;

  const [contactFirstName, setContactFirstName] = useState(lead.contact_first_name ?? '');
  const [contactLastName, setContactLastName] = useState(lead.contact_last_name ?? '');
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [companyName, setCompanyName] = useState(lead.company_name ?? '');
  const [industry, setIndustry] = useState(lead.industry ?? '');
  const [country, setCountry] = useState(lead.country ?? '');
  const [address, setAddress] = useState(lead.address ?? '');
  const [vatNumber, setVatNumber] = useState(lead.vat_number ?? '');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [oneTime, setOneTime] = useState(String(lead.estimated_one_time_value ?? 0));
  const [monthly, setMonthly] = useState(String(lead.estimated_monthly_value ?? 0));
  const [services, setServices] = useState<ServicesPlanned>(lead.services_planned);
  const [expectedClose, setExpectedClose] = useState<string>(lead.expected_close_date ?? '');

  function toNum(v: string) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: lead.id,
        patch: {
          contact_first_name: contactFirstName.trim() || null,
          contact_last_name: contactLastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          company_name: companyName.trim() || null,
          industry: industry.trim() || null,
          country: country.trim() || null,
          address: address.trim() || null,
          vat_number: vatNumber.trim() || null,
          notes: notes.trim() || null,
          estimated_one_time_value: toNum(oneTime),
          estimated_monthly_value: toNum(monthly),
          services_planned: services,
          expected_close_date: expectedClose || null,
        },
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fn">{t('form.contact_first_name')}</Label>
            <Input id="fn" value={contactFirstName} onChange={(e) => setContactFirstName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ln">{t('form.contact_last_name')}</Label>
            <Input id="ln" value={contactLastName} onChange={(e) => setContactLastName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">{t('form.email')}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="phone">{t('form.phone')}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="co">{t('form.company_name')}</Label>
            <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ind">{t('form.industry')}</Label>
            <Input id="ind" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cnt">{t('form.country')}</Label>
            <Input id="cnt" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="addr">{t('form.address')}</Label>
            <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="vat">{t('form.vat_number')}</Label>
            <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ecd">{t('form.expected_close_date')}</Label>
            <Input id="ecd" type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ot">{t('form.estimated_one_time_value')}</Label>
            <Input id="ot" inputMode="decimal" value={oneTime} onChange={(e) => setOneTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mo">{t('form.estimated_monthly_value')}</Label>
            <Input id="mo" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>{t('form.services_planned')}</Label>
            <ServicesPlannedField value={services} onChange={setServices} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="notes">{t('form.notes')}</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <Button type="submit" disabled={update.isPending}>
          {t('actions.save')}
        </Button>
      </fieldset>
    </form>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/leads/LeadForm.tsx
git commit -m "feat(leads): LeadForm (full edit form, read-only after conversion)"
git push origin main
```

---

## Task 8 — LeadDetailPage + route

**Files:**
- Create: `src/features/leads/LeadDetailPage.tsx`
- Modify: `src/app/router.tsx` — add `/leads/:leadId` route

- [ ] **Step 1: LeadDetailPage**

```tsx
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeadForm } from './LeadForm';
import { useLead } from './hooks/useLead';
import { useConvertLead } from './hooks/useConvertLead';
import { Button } from '@/components/ui/button';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';

export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const { t } = useTranslation('leads');
  const { data: lead, isLoading, error } = useLead(leadId);
  const convert = useConvertLead();

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !lead) return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  async function onConvert() {
    try {
      const result = await convert.mutateAsync(leadId);
      alert(`Converted. Client ${result.clientId} / Deal ${result.dealId}`);
    } catch (err) {
      const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
      alert(errors.map((er) => t(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{lead.title}</h1>
        {!lead.converted_at && (
          <Button onClick={onConvert} disabled={convert.isPending}>
            {t('actions.convert')}
          </Button>
        )}
        {lead.converted_at && (
          <span className="text-sm text-emerald-700">✓ converted</span>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <LeadForm lead={lead} />
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <CommentsPanel parentType="lead" parentId={leadId} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="lead" parentId={leadId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="leads" entityId={leadId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Add route**

In `src/app/router.tsx`:

Add import:
```tsx
import { LeadDetailPage } from '@/features/leads/LeadDetailPage';
```

Add route at top level (alongside `clients/:clientId`):
```tsx
{ path: 'leads/:leadId', element: <LeadDetailPage /> },
```

- [ ] **Step 3: Confirm CommentsPanel + AttachmentsPanel accept `parent_type='lead'`**

Read `src/features/comments/CommentsPanel.tsx` and `src/features/attachments/AttachmentsPanel.tsx` — they take `parent_type: string` so no change needed. RLS for `comments` and `attachments` already allows authenticated to insert+select; only the parent type label changes.

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(leads): LeadDetailPage with tabs + /leads/:leadId route + Convert button"
git push origin main
```

---

# Sub-phase D — Sales kanban swap (Tasks 9–10)

## Task 9 — Sales kanban data swap (deals → leads)

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx`
- Modify: `src/features/sales/SalesKanbanColumn.tsx`
- Modify: `src/features/sales/SalesKanbanCard.tsx`
- Modify: `src/features/sales/useSalesKanbanRealtime.ts`

The kanban shape is unchanged — same stages, same drag-drop. Only the data backing it changes.

- [ ] **Step 1: SalesKanbanCard — render lead fields**

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

export function SalesKanbanCard({ lead }: { lead: LeadRow }) {
  const { t } = useTranslation('leads');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { leadId: lead.id, currentStage: lead.stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const contactName = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
  const subtitle = lead.company_name || contactName || t('card.no_company');

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between">
            <Link to={`/leads/${lead.id}`} className="text-sm font-medium hover:underline">
              {lead.title}
            </Link>
            {lead.converted_at && <span className="text-xs text-emerald-600">✓</span>}
          </div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
          <div className="text-xs">
            {Number(lead.estimated_one_time_value ?? 0) > 0 && (
              <span>€{Number(lead.estimated_one_time_value).toFixed(0)}</span>
            )}
            {Number(lead.estimated_monthly_value ?? 0) > 0 && (
              <span className="ml-2">
                €{Number(lead.estimated_monthly_value).toFixed(0)}
                {t('card.monthly')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: SalesKanbanColumn — accept leads**

```tsx
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

type Props = {
  stageId: string;
  stageLabel: string;
  leads: LeadRow[];
};

export function SalesKanbanColumn({ stageId, stageLabel, leads }: Props) {
  const { t } = useTranslation('sales');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({leads.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          leads.map((l) => <SalesKanbanCard key={l.id} lead={l} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: useSalesKanbanRealtime — switch channel**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useSalesKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel('sales-kanban-leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);
}
```

- [ ] **Step 4: Gates + commit (kanban won-drop wiring is in Task 10)**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/sales/
git commit -m "refactor(sales): kanban card/column/realtime now driven by leads"
git push origin main
```

(SalesKanbanPage still imports `useDeals` — typecheck will fail until Task 10. If a temp commit is needed, comment out the SalesKanbanPage component body and stub `return null;` to keep tree compilable. Otherwise combine Tasks 9 and 10 into a single commit.)

**Recommended:** combine Tasks 9 and 10 into one commit — it's a single semantic change and the intermediate state isn't deployable.

---

## Task 10 — SalesKanbanPage rewrite + won-drop conversion

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx`
- Modify: `src/features/clients/ClientsListPage.tsx` (rename label only — see Step 5)

- [ ] **Step 1: SalesKanbanPage**

Replace entire body of `src/features/sales/SalesKanbanPage.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useLeads, type LeadRow } from '@/features/leads/hooks/useLeads';
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useConvertLead } from '@/features/leads/hooks/useConvertLead';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { SavedFiltersBar } from '@/features/saved_filters/SavedFiltersBar';
import { SalesKanbanColumn } from './SalesKanbanColumn';
import { useSalesKanbanRealtime } from './useSalesKanbanRealtime';
import { CreateLeadDialog } from '@/features/leads/CreateLeadDialog';

export function SalesKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  const { t: tLeads } = useTranslation('leads');
  useSalesKanbanRealtime();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [filter, setFilter] = useState<{ ownerId?: string }>({});
  const [createOpen, setCreateOpen] = useState(false);

  const leadsFilter: Parameters<typeof useLeads>[0] = filter.ownerId
    ? { ownerId: filter.ownerId }
    : {};
  const { data: leads = [], isLoading } = useLeads(leadsFilter);
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveLeadStage();
  const convert = useConvertLead();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (isLoading) return <div className="p-8">…</div>;

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const wonStage = salesStages.find((s) => s.code === 'won');

  const leadsByStage = new Map<string, LeadRow[]>();
  for (const s of salesStages) leadsByStage.set(s.id, []);
  for (const lead of leads) {
    if (lead.stage?.board !== 'sales') continue;
    const list = leadsByStage.get(lead.stage_id ?? '');
    if (list) list.push(lead);
  }

  async function onDragEnd(e: DragEndEvent) {
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    if (wonStage && stageId === wonStage.id) {
      try {
        await convert.mutateAsync(leadId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => tLeads(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ leadId, stageId });
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={filter.ownerId === userId ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter({ ownerId: userId ?? undefined })}
          >
            {t('filters.mine')}
          </Button>
          <Button
            variant={Object.keys(filter).length === 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter({})}
          >
            {t('filters.all')}
          </Button>
          <SavedFiltersBar board="sales:kanban" currentFilter={filter} onApply={setFilter} />
          <Button onClick={() => setCreateOpen(true)}>{tLeads('actions.create')}</Button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {salesStages.map((s) => (
            <SalesKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              leads={leadsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
      </DndContext>
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
```

- [ ] **Step 2: Combine with Task 9 changes** (if Task 9 was committed standalone with a stubbed page, this commit lands the real implementation.)

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/sales/SalesKanbanPage.tsx
git commit -m "feat(sales): kanban now lists leads; won-drop calls convert_lead_to_client"
git push origin main
```

---

# Sub-phase E — Cleanup (Tasks 11–12)

## Task 11 — Remove "+ New Deal" UI on ClientDetailPage; delete deal create artifacts

**Files:**
- Modify: `src/features/clients/ClientDetailPage.tsx`
- Delete: `src/features/deals/CreateDealDialog.tsx`
- Delete: `src/features/deals/DealForm.tsx`
- Delete: `src/features/deals/hooks/useUpsertDeal.ts`

The deal detail page (`/deals/:dealId`) stays — converted-from-lead deals still need viewing/editing in the Accounting Onboarding flow. We're only removing manual deal creation.

- [ ] **Step 1: ClientDetailPage — remove the dialog button**

In `src/features/clients/ClientDetailPage.tsx`:

```tsx
// REMOVE these imports:
import { CreateDealDialog } from '@/features/deals/CreateDealDialog';

// REMOVE this state:
const [dealOpen, setDealOpen] = useState(false);

// REPLACE the deals tab content. Was:
<TabsContent value="deals" className="pt-4 space-y-3">
  <Button onClick={() => setDealOpen(true)}>{t('tabs.deals')}: New</Button>
  {/* ... deal list ... */}
  <CreateDealDialog open={dealOpen} onOpenChange={setDealOpen} clientId={clientId} />
</TabsContent>

// New version (no button, no dialog):
<TabsContent value="deals" className="pt-4 space-y-3">
  {deals.length === 0 ? (
    <p className="text-sm text-muted-foreground">No deals yet.</p>
  ) : (
    <ul className="divide-y rounded-md border">
      {deals.map((d) => (
        <li key={d.id} className="flex items-center justify-between px-4 py-2">
          <span>{d.title}</span>
          <Link to={`/deals/${d.id}`} className="text-blue-600 underline text-sm">
            View
          </Link>
        </li>
      ))}
    </ul>
  )}
</TabsContent>
```

- [ ] **Step 2: Delete the unused files**

```bash
git rm src/features/deals/CreateDealDialog.tsx
git rm src/features/deals/DealForm.tsx
git rm src/features/deals/hooks/useUpsertDeal.ts
```

If anywhere else in the codebase imports these files, the import will break — check first:

```bash
grep -rEn "CreateDealDialog|DealForm|useUpsertDeal" src/ tests/ --include='*.ts' --include='*.tsx' | grep -v "src/features/deals/CreateDealDialog\|src/features/deals/DealForm\|src/features/deals/hooks/useUpsertDeal"
```

If grep returns hits, fix or remove each. Most likely candidates: `DealDetailPage` (which probably imports `DealForm` for editing) — if so, **don't** delete `DealForm.tsx`; only delete `CreateDealDialog.tsx` and `useUpsertDeal.ts`. Read each file to verify before removing.

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "refactor(clients): remove '+ New Deal' button (deals only via lead conversion); delete CreateDealDialog"
git push origin main
```

---

## Task 12 — Cleanup confirmation pass

**Files:** none — this task verifies Task 3 cleanup landed cleanly.

This task exists to make sure the recurring-billing removal from Task 3 stuck:

- [ ] **Step 1: Verify**

```bash
test -d src/features/billing && echo "FAIL: billing/ still exists" || echo "OK: billing/ removed"
grep -rEn "monthly_invoices\|generateMonthlyInvoices\|/accounting/recurring" src/ tests/ --include='*.ts' --include='*.tsx' --include='*.json' | grep -v "ALL_BOARDS\|ALL_ACTIONS" | head
```

Expected: `OK: billing/ removed`, and the second grep returns nothing.

If anything's lingering, edit/delete it and commit. If clean, skip the commit.

- [ ] **Step 2: Optional commit (only if cleanup needed)**

```bash
git add -A
git commit -m "chore: confirm recurring billing fully removed"
git push origin main
```

---

# Sub-phase F — Acceptance (Task 13)

## Task 13 — E2E + manual smoke

**Files:**
- Create: `tests/leads-smoke.spec.ts`

- [ ] **Step 1: E2E spec**

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

test.describe('leads smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can open the Sales kanban and see Add lead', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/kanban');
    await expect(page.getByRole('heading', { name: /kanban|sales|πωλήσεις/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /add lead|προσθήκη επαφής/i })).toBeVisible();
  });

  test('/accounting/recurring is gone (404 or redirect)', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    // SPA route doesn't exist — should fall through to NotFoundPage
    await expect(page.getByText(/not found|404/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Local + e2e**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
PLAYWRIGHT_BASE_URL=https://itdevcrm.vercel.app E2E_ADMIN_EMAIL=info@itdev.gr E2E_ADMIN_PASSWORD=<your admin password> npm run test:e2e
```

All exit 0.

- [ ] **Step 3: Manual acceptance** (USER ACTION at https://itdevcrm.vercel.app)

- [ ] Sign in as admin → sidebar Sales section visible. No "Recurring" link under Accounting.
- [ ] `/sales/kanban` → shows empty stages + "Add lead" button.
- [ ] Click "Add lead" → fill source=manual, title="Test lead", first name, phone (only) → submit → navigates to `/leads/<id>`.
- [ ] On lead detail page: tabs are Overview/Comments/Attachments/Activity. Overview form is editable; fill in email, company name, address, services planned, one-time + monthly values. Save.
- [ ] Drop a contract attachment in Attachments tab.
- [ ] Back on `/sales/kanban` → drag the lead through the stages → it moves left-to-right correctly.
- [ ] Drag the lead onto **Won** column → conversion succeeds → lead disappears from kanban (now has `converted_at`); deal lands on `/accounting/onboarding` kanban as `New`.
- [ ] Try dropping an incomplete lead onto Won → see localized error list (missing fields). Fix and try again.
- [ ] On a converted lead's detail page: Convert button is gone, form is read-only.
- [ ] `/accounting/recurring` → 404 / NotFound.
- [ ] EL switch → all leads pages translated.

- [ ] **Step 4: Commit (only the spec)**

```bash
git add tests/leads-smoke.spec.ts
git commit -m "test(e2e): leads smoke + verify /accounting/recurring removed"
git push origin main
```

---

## Out of scope for this plan (do NOT do now)

- **Meta Lead Ads webhook** — separate plan; needs Meta Business Manager OAuth, Graph API subscription, signature verification, and an Edge Function endpoint.
- **CSV/Excel import** — separate plan; UI for column mapping, validation, batch insert.
- **"My Leads" cross-dept view** — leads are sales-only; no cross-dept visibility needed.
- **Lead-to-existing-client linking** (e.g., upsell to a known client) — for now, every conversion creates a new client. Reuse becomes a feature request after MVP usage.
- **Phase 6 (technical sub-departments × 4 kanbans)** — next phase after this is shipped and verified.

If a task starts touching any of the above, stop and revisit.
