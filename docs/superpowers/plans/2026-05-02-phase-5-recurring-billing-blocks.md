# Phase 5 — Recurring Billing + Client Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monthly recurring billing surface + client blocking. After Phase 5, accounting can: (a) generate consolidated monthly invoices for all active recurring jobs at any client, (b) mark invoices paid/partial, (c) see overdue invoices auto-flagged daily, (d) block a client (suspends `move_stage` on all their jobs across tech kanbans, with a visible badge), (e) unblock a client.

**Architecture:** Three new tables: `monthly_invoices` (one row per client per period), `monthly_invoice_items` (per-job line items), `client_blocks` (one active row per client at a time, partial unique index where `unblocked_at IS NULL`). Three new RPCs: `generate_monthly_invoices(period)`, `block_client(client_id, reason)`, `unblock_client(client_id)`. One new function `mark_overdue_invoices()` runs daily via `pg_cron`. Job-level RLS extended so `move_stage` is denied while client is blocked.

**Tech Stack:** All from Phases 0–4 plus Postgres `pg_cron` extension (Supabase has it pre-installed).

**Reference spec:** `docs/superpowers/specs/2026-05-01-itdevcrm-design.md` — Sections 6.5 (recurring billing schema), 8.3 (Accounting recurring workflow), brainstorming Q9A=ii (mixed billing types), Q9B=i (consolidated per client per month), Q9C=i (manual generation), Q9D=ii (auto-mark overdue), Q9E=ii (soft block: stage moves denied, other actions allowed), Q9F=i (accounting + admin only), Q9G=i (per-client block).

**Builds on:** Phases 0–4 (all shipped to main, audited clean).

**Branch:** `main` (push directly per project memory).

---

## Sub-phase grouping

```
A. Schema (Tasks 1–3)        tables, RPCs, pg_cron, types regen
B. Block client (Tasks 4–6)  hooks, UI button + badge, RLS soft-block on jobs
C. Recurring UI (Tasks 7–11) i18n, hooks, /accounting/recurring page, generate dialog, mark-paid
D. Acceptance (Tasks 12–13)  e2e smoke + manual pass
```

---

## File Structure (Phase 5 outcome)

```
.
├── supabase/
│   └── migrations/
│       ├── 20260502000014_recurring_billing_blocks.sql      # tables + RLS
│       ├── 20260502000015_recurring_billing_rpcs.sql        # generate_monthly_invoices, mark_overdue_invoices
│       └── 20260502000016_block_client_rpcs.sql             # block_client / unblock_client + jobs RLS update
├── src/
│   ├── lib/
│   │   ├── queryKeys.ts                                     # MODIFY: monthlyInvoices, clientBlocks
│   │   └── rpc.ts                                           # MODIFY: generateMonthlyInvoices, blockClient, unblockClient, markInvoicePaid
│   ├── features/
│   │   ├── client_blocks/
│   │   │   ├── hooks/
│   │   │   │   ├── useClientBlock.ts                        # current block status for a client
│   │   │   │   ├── useBlockClient.ts                        # mutation
│   │   │   │   └── useUnblockClient.ts                      # mutation
│   │   │   ├── BlockClientDialog.tsx                        # ask for reason
│   │   │   └── BlockBadge.tsx                               # red "Blocked – Awaiting Accounting" pill
│   │   └── billing/
│   │       ├── hooks/
│   │       │   ├── useMonthlyInvoices.ts
│   │       │   ├── useMonthlyInvoice.ts                     # with items + client
│   │       │   ├── useGenerateMonthlyInvoices.ts
│   │       │   ├── useMarkInvoicePaid.ts
│   │       │   └── useMarkInvoicePartial.ts
│   │       ├── AccountingRecurringPage.tsx                  # /accounting/recurring
│   │       ├── GenerateInvoicesDialog.tsx
│   │       └── InvoiceDetailDialog.tsx                      # shows line items + mark-paid
│   ├── features/clients/ClientDetailPage.tsx                # MODIFY: Block button + badge
│   ├── features/clients/ClientsListPage.tsx                 # MODIFY: badge in list
│   ├── app/router.tsx                                       # MODIFY: /accounting/recurring
│   ├── components/layout/Sidebar.tsx                        # MODIFY: Recurring link in Accounting group
│   └── i18n/locales/{en,el}/accounting.json                 # MODIFY: recurring + block keys
└── tests/
    └── recurring-smoke.spec.ts                               # NEW
```

---

## Conventions

- Every task ends in commit + push to `main`.
- **REQUIRED gate verification protocol**: each subagent runs `npm run format:check && npm run lint && npm run typecheck && npm run test:run` as a single chained command; commit only if `exit: 0`. Auto-fix with `npm run format` if needed.
- Migration env vars: `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` already in shell.
- Regenerate types after every migration: `npm run types:gen`.

---

# Sub-phase A — Schema (Tasks 1–3)

## Task 1 — Migration: tables (monthly_invoices, monthly_invoice_items, client_blocks)

**Files:**
- Create: `supabase/migrations/20260502000014_recurring_billing_blocks.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 5 migration: monthly_invoices + monthly_invoice_items + client_blocks
-- =============================================================================

-- ---------------------------------------------------------------------------
-- monthly_invoices  (one row per client per period; consolidated)
-- ---------------------------------------------------------------------------
create table public.monthly_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
  due_date date not null,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) default 0,
  tax_amount numeric(12,2) default 0,
  total_amount numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid', 'overdue')),
  payment_method text,
  paid_at timestamptz,
  notes text,
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period)
);

create index monthly_invoices_status on public.monthly_invoices (status) where archived = false;
create index monthly_invoices_period on public.monthly_invoices (period desc);
create index monthly_invoices_client on public.monthly_invoices (client_id, period desc);

create trigger monthly_invoices_set_updated_at
  before update on public.monthly_invoices
  for each row execute function public.set_updated_at();

create trigger monthly_invoices_activity
  after insert or update or delete on public.monthly_invoices
  for each row execute function public.log_activity('id');

alter table public.monthly_invoices enable row level security;

create policy monthly_invoices_select
  on public.monthly_invoices for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('clients', 'view')
  );

create policy monthly_invoices_mutate
  on public.monthly_invoices for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  );

-- ---------------------------------------------------------------------------
-- monthly_invoice_items  (per-job line item)
-- ---------------------------------------------------------------------------
create table public.monthly_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.monthly_invoices(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  service_type text,
  amount numeric(12,2) not null,
  description text,
  created_at timestamptz not null default now()
);

create index monthly_invoice_items_invoice on public.monthly_invoice_items (invoice_id);

alter table public.monthly_invoice_items enable row level security;

create policy monthly_invoice_items_select
  on public.monthly_invoice_items for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('clients', 'view')
  );

create policy monthly_invoice_items_mutate
  on public.monthly_invoice_items for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  );

-- ---------------------------------------------------------------------------
-- client_blocks
-- One active row per client at a time, enforced by partial unique index.
-- ---------------------------------------------------------------------------
create table public.client_blocks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid references public.profiles(user_id),
  reason text not null,
  unblocked_at timestamptz,
  unblocked_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create unique index client_blocks_active_unique
  on public.client_blocks (client_id)
  where unblocked_at is null;

create index client_blocks_client on public.client_blocks (client_id, blocked_at desc);

create trigger client_blocks_activity
  after insert or update or delete on public.client_blocks
  for each row execute function public.log_activity('id');

alter table public.client_blocks enable row level security;

create policy client_blocks_select
  on public.client_blocks for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('web_seo', 'view')
    or public.current_user_can('local_seo', 'view')
    or public.current_user_can('web_dev', 'view')
    or public.current_user_can('social_media', 'view')
  );

-- INSERT/UPDATE only via RPCs (block_client / unblock_client). No direct mutate policy.
-- service_role from RPC bypasses RLS.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000014_recurring_billing_blocks.sql
git commit -m "feat(db): monthly_invoices + monthly_invoice_items + client_blocks tables"
git push
```

---

## Task 2 — Migration: generate_monthly_invoices RPC + mark_overdue_invoices + pg_cron

**Files:**
- Create: `supabase/migrations/20260502000015_recurring_billing_rpcs.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 5 migration: recurring billing RPCs + daily overdue job
-- =============================================================================

-- ---------------------------------------------------------------------------
-- generate_monthly_invoices(period) — manual, idempotent
-- For every client with at least one active recurring job, insert one
-- monthly_invoices row + one monthly_invoice_items row per job (if not exists).
-- ---------------------------------------------------------------------------
create or replace function public.generate_monthly_invoices(target_period text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  client_record record;
  job_record record;
  invoice_id uuid;
  total numeric(12,2);
  item_count int;
  generated_count int := 0;
  due_offset_days int := 14;
  due date;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_recurring', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if target_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_period_format']);
  end if;

  due := (target_period || '-01')::date + (due_offset_days * interval '1 day');

  -- For each client with active recurring jobs (and not blocked? — block doesn't suspend invoicing)
  for client_record in
    select distinct j.client_id
    from public.jobs j
    where j.archived = false
      and j.status = 'active'
      and j.billing_type = 'recurring_monthly'
  loop
    -- Skip if invoice already exists for this client+period
    if exists (
      select 1 from public.monthly_invoices
      where client_id = client_record.client_id and period = target_period
    ) then
      continue;
    end if;

    total := 0;
    item_count := 0;

    -- Create the invoice row first to get an id
    insert into public.monthly_invoices (
      client_id, period, due_date, subtotal, total_amount, status
    ) values (
      client_record.client_id, target_period, due, 0, 0, 'pending'
    ) returning id into invoice_id;

    -- Add one item per active recurring job for this client
    for job_record in
      select id, service_type, monthly_amount
      from public.jobs
      where client_id = client_record.client_id
        and archived = false
        and status = 'active'
        and billing_type = 'recurring_monthly'
        and monthly_amount is not null
        and monthly_amount > 0
    loop
      insert into public.monthly_invoice_items (
        invoice_id, job_id, service_type, amount, description
      ) values (
        invoice_id, job_record.id, job_record.service_type,
        job_record.monthly_amount,
        job_record.service_type || ' — ' || target_period
      );
      total := total + job_record.monthly_amount;
      item_count := item_count + 1;
    end loop;

    if item_count = 0 then
      -- No billable items — delete the empty invoice
      delete from public.monthly_invoices where id = invoice_id;
    else
      update public.monthly_invoices
        set subtotal = total, total_amount = total
        where id = invoice_id;
      generated_count := generated_count + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'period', target_period, 'invoices_generated', generated_count);
end $$;

grant execute on function public.generate_monthly_invoices(text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_overdue_invoices() — flips status='overdue' on past-due unpaid invoices
-- ---------------------------------------------------------------------------
create or replace function public.mark_overdue_invoices()
returns int
language plpgsql security definer set search_path = public as $$
declare
  flipped int;
begin
  update public.monthly_invoices
    set status = 'overdue'
    where archived = false
      and status in ('pending', 'partial')
      and due_date < current_date;
  get diagnostics flipped = row_count;
  return flipped;
end $$;

grant execute on function public.mark_overdue_invoices() to authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron: schedule mark_overdue_invoices() daily at 02:00 UTC
-- (Supabase Pro has pg_cron pre-installed; the cron schema is `cron`.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'daily_mark_overdue_invoices',
      '0 2 * * *',
      $cron$ select public.mark_overdue_invoices(); $cron$
    );
  end if;
end $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000015_recurring_billing_rpcs.sql
git commit -m "feat(db): generate_monthly_invoices RPC + mark_overdue_invoices + pg_cron daily"
git push
```

---

## Task 3 — Migration: block_client RPCs + jobs RLS update + apply + types

**Files:**
- Create: `supabase/migrations/20260502000016_block_client_rpcs.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 5 migration: block_client / unblock_client RPCs + jobs RLS soft-block
-- =============================================================================

-- ---------------------------------------------------------------------------
-- helper: is_client_blocked(client_id) -> bool
-- ---------------------------------------------------------------------------
create or replace function public.is_client_blocked(target_client_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_blocks
    where client_id = target_client_id
      and unblocked_at is null
  );
$$;

grant execute on function public.is_client_blocked(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- block_client(client_id, reason)
-- ---------------------------------------------------------------------------
create or replace function public.block_client(target_client_id uuid, reason_text text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record;
  block_id uuid;
begin
  if not (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'block_client')
    or public.current_user_can('accounting_onboarding', 'block_client')
  ) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if reason_text is null or length(trim(reason_text)) = 0 then
    return jsonb_build_object('ok', false, 'errors', array['reason_required']);
  end if;

  select * into c from public.clients where id = target_client_id;
  if c is null then
    return jsonb_build_object('ok', false, 'errors', array['client_not_found']);
  end if;

  if public.is_client_blocked(target_client_id) then
    return jsonb_build_object('ok', false, 'errors', array['already_blocked']);
  end if;

  insert into public.client_blocks (client_id, blocked_by, reason)
  values (target_client_id, auth.uid(), trim(reason_text))
  returning id into block_id;

  return jsonb_build_object('ok', true, 'block_id', block_id);
end $$;

grant execute on function public.block_client(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- unblock_client(client_id)
-- ---------------------------------------------------------------------------
create or replace function public.unblock_client(target_client_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  active_block record;
begin
  if not (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'unblock_client')
    or public.current_user_can('accounting_onboarding', 'unblock_client')
  ) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into active_block
  from public.client_blocks
  where client_id = target_client_id and unblocked_at is null
  limit 1;

  if active_block is null then
    return jsonb_build_object('ok', false, 'errors', array['not_blocked']);
  end if;

  update public.client_blocks
    set unblocked_at = now(), unblocked_by = auth.uid()
    where id = active_block.id;

  return jsonb_build_object('ok', true, 'block_id', active_block.id);
end $$;

grant execute on function public.unblock_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- jobs RLS soft-block: extend the existing jobs_mutate_admin_or_service policy
-- to deny stage_id changes when the client is blocked.
-- We re-create the policy with an additional check.
-- ---------------------------------------------------------------------------
drop policy if exists jobs_mutate_admin_or_service on public.jobs;

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

-- For move_stage prevention while blocked, we use a row-level trigger that
-- raises an exception when stage_id changes on a blocked client's job.
-- (RLS WITH CHECK can't easily compare OLD vs NEW values; a BEFORE UPDATE
-- trigger is the right tool.)
create or replace function public.enforce_no_stage_move_when_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.stage_id is distinct from new.stage_id then
    if public.is_client_blocked(new.client_id) and not public.current_user_is_admin() then
      raise exception 'client_blocked' using errcode = 'P0001', hint = 'unblock_client_first';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_no_stage_move_when_blocked on public.jobs;
create trigger jobs_no_stage_move_when_blocked
  before update on public.jobs
  for each row execute function public.enforce_no_stage_move_when_blocked();
```

- [ ] **Step 2: Apply all 3 migrations**

```bash
echo y | npx -y supabase@latest db push 2>&1 | tail -10
```

- [ ] **Step 3: Verify**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')
for t in monthly_invoices monthly_invoice_items client_blocks; do
  echo -n "  $t: "
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" "${URL}/rest/v1/${t}?select=*&limit=1" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
done
echo "RPCs:"
for rpc in generate_monthly_invoices mark_overdue_invoices block_client unblock_client is_client_blocked; do
  case "$rpc" in
    generate_monthly_invoices) BODY='{"target_period":"2026-05"}' ;;
    block_client) BODY='{"target_client_id":"00000000-0000-0000-0000-000000000000","reason_text":"test"}' ;;
    unblock_client|is_client_blocked) BODY='{"target_client_id":"00000000-0000-0000-0000-000000000000"}' ;;
    *) BODY='{}' ;;
  esac
  echo -n "  $rpc: "
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST "${URL}/rest/v1/rpc/${rpc}" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -H "Content-Type: application/json" -d "$BODY"
done
```

All HTTP 200.

- [ ] **Step 4: Regen types + gates**

```bash
npm run types:gen
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260502000016_block_client_rpcs.sql src/types/supabase.ts
git commit -m "feat(db): block_client/unblock_client RPCs + jobs no-stage-move-when-blocked trigger; types regen"
git push
```

---

# Sub-phase B — Block client (Tasks 4–6)

## Task 4 — Block hooks + BlockBadge

**Files:**
- Modify: `src/lib/queryKeys.ts` — add `clientBlock(clientId)`
- Modify: `src/lib/rpc.ts` — append `blockClient`, `unblockClient`
- Create: `src/features/client_blocks/hooks/useClientBlock.ts`
- Create: `src/features/client_blocks/hooks/useBlockClient.ts`
- Create: `src/features/client_blocks/hooks/useUnblockClient.ts`
- Create: `src/features/client_blocks/BlockBadge.tsx`
- Modify: `src/i18n/locales/en/accounting.json` — block keys
- Modify: `src/i18n/locales/el/accounting.json` — block keys

- [ ] **Step 1: queryKeys**

Append to `src/lib/queryKeys.ts`:
```ts
clientBlock: (clientId: string) => ['client-block', clientId] as const,
monthlyInvoices: (filters?: Record<string, string | undefined>) => ['monthly-invoices', filters ?? null] as const,
monthlyInvoice: (id: string) => ['monthly-invoice', id] as const,
```

- [ ] **Step 2: RPC wrappers**

Append to `src/lib/rpc.ts`:
```ts
export type BlockClientResult = { ok: true; block_id: string } | { ok: false; errors: string[] };
export type UnblockClientResult = { ok: true; block_id: string } | { ok: false; errors: string[] };
export type GenerateInvoicesResult =
  | { ok: true; period: string; invoices_generated: number }
  | { ok: false; errors: string[] };

export async function blockClient(clientId: string, reason: string): Promise<BlockClientResult> {
  const { data, error } = await supabase.rpc('block_client', {
    target_client_id: clientId,
    reason_text: reason,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as BlockClientResult;
}

export async function unblockClient(clientId: string): Promise<UnblockClientResult> {
  const { data, error } = await supabase.rpc('unblock_client', { target_client_id: clientId });
  if (error) return { ok: false, errors: [error.message] };
  return data as UnblockClientResult;
}

export async function generateMonthlyInvoices(period: string): Promise<GenerateInvoicesResult> {
  const { data, error } = await supabase.rpc('generate_monthly_invoices', { target_period: period });
  if (error) return { ok: false, errors: [error.message] };
  return data as GenerateInvoicesResult;
}
```

- [ ] **Step 3: useClientBlock**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ClientBlockRow = {
  id: string;
  client_id: string;
  blocked_at: string;
  blocked_by: string | null;
  reason: string;
  unblocked_at: string | null;
};

export function useClientBlock(clientId: string) {
  return useQuery({
    queryKey: queryKeys.clientBlock(clientId),
    queryFn: async (): Promise<ClientBlockRow | null> => {
      const { data, error } = await supabase
        .from('client_blocks')
        .select('*')
        .eq('client_id', clientId)
        .is('unblocked_at', null)
        .order('blocked_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ClientBlockRow | null) ?? null;
    },
    enabled: !!clientId,
  });
}
```

- [ ] **Step 4: useBlockClient + useUnblockClient**

```ts
// useBlockClient.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { blockClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useBlockClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, reason }: { clientId: string; reason: string }) => {
      const result = await blockClient(clientId, reason);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'block_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.block_id;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clientBlock(vars.clientId) });
    },
  });
}
```

```ts
// useUnblockClient.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unblockClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useUnblockClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const result = await unblockClient(clientId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'unblock_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.block_id;
    },
    onSuccess: (_d, clientId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clientBlock(clientId) });
    },
  });
}
```

- [ ] **Step 5: BlockBadge**

```tsx
import { useTranslation } from 'react-i18next';
import { useClientBlock } from './hooks/useClientBlock';

export function BlockBadge({ clientId }: { clientId: string }) {
  const { t } = useTranslation('accounting');
  const { data: block } = useClientBlock(clientId);
  if (!block) return null;
  return (
    <span
      className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700"
      title={block.reason}
    >
      🚫 {t('block.badge')}
    </span>
  );
}
```

- [ ] **Step 6: i18n keys**

Edit `src/i18n/locales/en/accounting.json`. Append `block` section:
```json
"block": {
  "badge": "Blocked – Awaiting Accounting",
  "button": "Block client",
  "button_unblock": "Unblock client",
  "dialog_title": "Block this client?",
  "dialog_body": "Reason (visible to other staff):",
  "submit": "Block",
  "cancel": "Cancel",
  "errors": {
    "permission_denied": "You do not have permission to block clients.",
    "reason_required": "A reason is required.",
    "client_not_found": "Client not found.",
    "already_blocked": "This client is already blocked.",
    "not_blocked": "This client is not currently blocked.",
    "client_blocked": "Cannot move stage — client is blocked. Unblock the client first."
  }
}
```

Edit `src/i18n/locales/el/accounting.json`. Append `block` section:
```json
"block": {
  "badge": "Μπλοκαρισμένος – Αναμονή Λογιστηρίου",
  "button": "Μπλοκάρισμα πελάτη",
  "button_unblock": "Ξεμπλοκάρισμα πελάτη",
  "dialog_title": "Μπλοκάρισμα πελάτη;",
  "dialog_body": "Αιτιολογία (ορατή σε άλλους χρήστες):",
  "submit": "Μπλοκάρισμα",
  "cancel": "Άκυρο",
  "errors": {
    "permission_denied": "Δεν έχετε δικαίωμα να μπλοκάρετε πελάτες.",
    "reason_required": "Απαιτείται αιτιολογία.",
    "client_not_found": "Δεν βρέθηκε πελάτης.",
    "already_blocked": "Ο πελάτης είναι ήδη μπλοκαρισμένος.",
    "not_blocked": "Ο πελάτης δεν είναι μπλοκαρισμένος.",
    "client_blocked": "Δεν μπορεί να αλλάξει στάδιο — ο πελάτης είναι μπλοκαρισμένος. Ξεμπλοκάρετε πρώτα."
  }
}
```

- [ ] **Step 7: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(client_blocks): hooks + RPC wrappers + BlockBadge + EN/EL i18n"
git push
```

---

## Task 5 — Block button + dialog on ClientDetailPage; badge in ClientsListPage

**Files:**
- Create: `src/features/client_blocks/BlockClientDialog.tsx`
- Modify: `src/features/clients/ClientDetailPage.tsx` — add Block/Unblock button + BlockBadge near the heading
- Modify: `src/features/clients/ClientsListPage.tsx` — show BlockBadge inline next to client name

- [ ] **Step 1: BlockClientDialog**

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useBlockClient } from './hooks/useBlockClient';

type Props = { open: boolean; onOpenChange: (v: boolean) => void; clientId: string };

export function BlockClientDialog({ open, onOpenChange, clientId }: Props) {
  const { t } = useTranslation('accounting');
  const block = useBlockClient();
  const [reason, setReason] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    try {
      await block.mutateAsync({ clientId, reason: reason.trim() });
      onOpenChange(false);
      setReason('');
    } catch (err) {
      const msg = (err as Error).message;
      alert(t(`block.errors.${msg}`, { defaultValue: msg }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('block.dialog_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="reason">{t('block.dialog_body')}</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('block.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={block.isPending || !reason.trim()}>
              {t('block.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: ClientDetailPage — Block/Unblock button + badge**

Read `src/features/clients/ClientDetailPage.tsx`. Add imports:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useClientBlock } from '@/features/client_blocks/hooks/useClientBlock';
import { useUnblockClient } from '@/features/client_blocks/hooks/useUnblockClient';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { BlockClientDialog } from '@/features/client_blocks/BlockClientDialog';
```

After fetching `client`, add:

```tsx
const { t: tAcc } = useTranslation('accounting');
const { data: block } = useClientBlock(clientId);
const unblock = useUnblockClient();
const [blockOpen, setBlockOpen] = useState(false);
```

Modify the heading area to include badge + button:

```tsx
<div className="flex items-center justify-between">
  <div className="flex items-center gap-3">
    <h1 className="text-2xl font-bold">{client.name}</h1>
    <BlockBadge clientId={clientId} />
  </div>
  {block ? (
    <Button variant="outline" onClick={() => unblock.mutate(clientId)} disabled={unblock.isPending}>
      {tAcc('block.button_unblock')}
    </Button>
  ) : (
    <Button variant="destructive" onClick={() => setBlockOpen(true)}>
      {tAcc('block.button')}
    </Button>
  )}
</div>
<BlockClientDialog open={blockOpen} onOpenChange={setBlockOpen} clientId={clientId} />
```

- [ ] **Step 3: ClientsListPage — show badge inline**

Read `src/features/clients/ClientsListPage.tsx`. Import:

```tsx
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
```

In the `<td>` rendering the client name, add the badge:

```tsx
<td className="py-2 pr-4 font-medium">
  <span className="inline-flex items-center gap-2">
    {c.name}
    <BlockBadge clientId={c.id} />
  </span>
</td>
```

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(clients): Block/Unblock button + dialog + badge on detail and list pages"
git push
```

---

## Task 6 — Verify soft-block enforcement on jobs (manual smoke + verify trigger)

**Files:** none (verification only)

- [ ] **Step 1: Run an end-to-end SQL smoke**

Open Supabase Dashboard → SQL Editor. Run:

```sql
-- Pick any existing client + a job for them (Phase 4 spawned jobs at complete_accounting).
-- If no jobs exist yet, this test is informational; the trigger is in place.
select id, client_id, stage_id, archived from public.jobs limit 1;

-- If a job exists:
-- 1. Block the client.
-- 2. Try to update the stage_id (impersonate authenticated role).
-- 3. Expect: 'client_blocked' exception.
-- 4. Unblock.
-- 5. Try update again — should succeed.

-- For now we just verify the trigger function and constraint exist:
select tgname, tgenabled from pg_trigger where tgrelid = 'public.jobs'::regclass;
select proname from pg_proc where proname in ('enforce_no_stage_move_when_blocked', 'is_client_blocked');
```

Confirm `jobs_no_stage_move_when_blocked` is in the trigger list and both functions exist.

- [ ] **Step 2: No code changes — task complete after verification.**

If anything's wrong, return to Task 3 and fix the migration.

---

# Sub-phase C — Recurring billing UI (Tasks 7–11)

## Task 7 — accounting i18n recurring keys

**Files:**
- Modify: `src/i18n/locales/en/accounting.json`
- Modify: `src/i18n/locales/el/accounting.json`

- [ ] **Step 1: EN — append `recurring` section**

```json
"recurring": {
  "title": "Recurring billing",
  "table": {
    "client": "Client",
    "period": "Period",
    "due_date": "Due",
    "total": "Total",
    "paid": "Paid",
    "status": "Status"
  },
  "status": {
    "pending": "Pending",
    "partial": "Partial",
    "paid": "Paid",
    "overdue": "Overdue"
  },
  "actions": {
    "generate": "Generate invoices",
    "view": "View",
    "mark_paid": "Mark paid",
    "mark_partial": "Mark partial"
  },
  "generate": {
    "dialog_title": "Generate monthly invoices",
    "period_label": "Period (YYYY-MM)",
    "submit": "Generate",
    "submitting": "Generating…",
    "success": "Generated {{count}} invoices for {{period}}.",
    "errors": {
      "permission_denied": "You do not have permission to generate invoices.",
      "invalid_period_format": "Period must be in YYYY-MM format."
    }
  },
  "items": {
    "title": "Line items",
    "service": "Service",
    "amount": "Amount",
    "description": "Description"
  },
  "empty": "No invoices yet — click \"Generate invoices\" to create them for the current month."
}
```

- [ ] **Step 2: EL — append `recurring` section**

```json
"recurring": {
  "title": "Επαναλαμβανόμενη χρέωση",
  "table": {
    "client": "Πελάτης",
    "period": "Περίοδος",
    "due_date": "Λήγει",
    "total": "Σύνολο",
    "paid": "Πληρωμένο",
    "status": "Κατάσταση"
  },
  "status": {
    "pending": "Σε αναμονή",
    "partial": "Μερική",
    "paid": "Πληρώθηκε",
    "overdue": "Ληξιπρόθεσμη"
  },
  "actions": {
    "generate": "Δημιουργία τιμολογίων",
    "view": "Προβολή",
    "mark_paid": "Σήμανση ως πληρωμένο",
    "mark_partial": "Σήμανση ως μερική"
  },
  "generate": {
    "dialog_title": "Δημιουργία μηνιαίων τιμολογίων",
    "period_label": "Περίοδος (YYYY-MM)",
    "submit": "Δημιουργία",
    "submitting": "Δημιουργία…",
    "success": "Δημιουργήθηκαν {{count}} τιμολόγια για {{period}}.",
    "errors": {
      "permission_denied": "Δεν έχετε δικαίωμα δημιουργίας τιμολογίων.",
      "invalid_period_format": "Η περίοδος πρέπει να είναι σε μορφή YYYY-MM."
    }
  },
  "items": {
    "title": "Γραμμές τιμολογίου",
    "service": "Υπηρεσία",
    "amount": "Ποσό",
    "description": "Περιγραφή"
  },
  "empty": "Δεν υπάρχουν τιμολόγια — πατήστε «Δημιουργία τιμολογίων» για τον τρέχοντα μήνα."
}
```

Place these `recurring` sections at the same level as the existing `nav`, `kanban`, `card`, `actions`, `complete`, `block` sections.

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(i18n): accounting recurring + status keys EN+EL"
git push
```

---

## Task 8 — Recurring billing hooks

**Files:**
- Create: `src/features/billing/hooks/useMonthlyInvoices.ts`
- Create: `src/features/billing/hooks/useMonthlyInvoice.ts`
- Create: `src/features/billing/hooks/useGenerateMonthlyInvoices.ts`
- Create: `src/features/billing/hooks/useMarkInvoicePaid.ts`
- Create: `src/features/billing/hooks/useMarkInvoicePartial.ts`

- [ ] **Step 1: useMonthlyInvoices**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type MonthlyInvoiceRow = Database['public']['Tables']['monthly_invoices']['Row'] & {
  client?: { id: string; name: string } | null;
};

export type MonthlyInvoicesFilter = {
  status?: 'pending' | 'partial' | 'paid' | 'overdue';
  period?: string;
};

export function useMonthlyInvoices(filter: MonthlyInvoicesFilter = {}) {
  return useQuery({
    queryKey: queryKeys.monthlyInvoices(filter as Record<string, string | undefined>),
    queryFn: async (): Promise<MonthlyInvoiceRow[]> => {
      let q = supabase
        .from('monthly_invoices')
        .select('*, client:clients(id, name)')
        .eq('archived', false)
        .order('due_date', { ascending: false });
      if (filter.status) q = q.eq('status', filter.status);
      if (filter.period) q = q.eq('period', filter.period);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as MonthlyInvoiceRow[];
    },
  });
}
```

- [ ] **Step 2: useMonthlyInvoice (with items)**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { MonthlyInvoiceRow } from './useMonthlyInvoices';

export type MonthlyInvoiceItem = {
  id: string;
  invoice_id: string;
  job_id: string | null;
  service_type: string | null;
  amount: number;
  description: string | null;
};

export type MonthlyInvoiceWithItems = MonthlyInvoiceRow & {
  items: MonthlyInvoiceItem[];
};

export function useMonthlyInvoice(invoiceId: string) {
  return useQuery({
    queryKey: queryKeys.monthlyInvoice(invoiceId),
    queryFn: async (): Promise<MonthlyInvoiceWithItems> => {
      const { data: invoice, error: e1 } = await supabase
        .from('monthly_invoices')
        .select('*, client:clients(id, name)')
        .eq('id', invoiceId)
        .single();
      if (e1 || !invoice) throw new Error(e1?.message ?? 'Not found');
      const { data: items, error: e2 } = await supabase
        .from('monthly_invoice_items')
        .select('id, invoice_id, job_id, service_type, amount, description')
        .eq('invoice_id', invoiceId)
        .order('created_at');
      if (e2) throw new Error(e2.message);
      return { ...(invoice as unknown as MonthlyInvoiceRow), items: (items ?? []) as unknown as MonthlyInvoiceItem[] };
    },
    enabled: !!invoiceId,
  });
}
```

- [ ] **Step 3: useGenerateMonthlyInvoices**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateMonthlyInvoices } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useGenerateMonthlyInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      const result = await generateMonthlyInvoices(period);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'generate_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return { period: result.period, count: result.invoices_generated };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoices() });
    },
  });
}
```

- [ ] **Step 4: useMarkInvoicePaid + useMarkInvoicePartial**

```ts
// useMarkInvoicePaid.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, total }: { id: string; total: number }) => {
      const { error } = await supabase
        .from('monthly_invoices')
        .update({
          status: 'paid',
          amount_paid: total,
          paid_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoices() });
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoice(vars.id) });
    },
  });
}
```

```ts
// useMarkInvoicePartial.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useMarkInvoicePartial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amountPaid }: { id: string; amountPaid: number }) => {
      const { error } = await supabase
        .from('monthly_invoices')
        .update({
          status: 'partial',
          amount_paid: amountPaid,
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoices() });
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoice(vars.id) });
    },
  });
}
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add src/features/billing/
git commit -m "feat(billing): hooks for monthly invoices + generate/mark-paid mutations"
git push
```

---

## Task 9 — AccountingRecurringPage (table view)

**Files:**
- Create: `src/features/billing/AccountingRecurringPage.tsx`
- Modify: `src/app/router.tsx` — `/accounting/recurring`
- Modify: `src/components/layout/Sidebar.tsx` — add Recurring link in Accounting group

- [ ] **Step 1: Page**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { useMonthlyInvoices } from './hooks/useMonthlyInvoices';
import { GenerateInvoicesDialog } from './GenerateInvoicesDialog';
import { InvoiceDetailDialog } from './InvoiceDetailDialog';

export function AccountingRecurringPage() {
  const { t } = useTranslation('accounting');
  const [genOpen, setGenOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: invoices = [], isLoading } = useMonthlyInvoices();

  if (isLoading) return <div className="p-8">…</div>;

  return (
    <div className="space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('recurring.title')}</h1>
        <Button onClick={() => setGenOpen(true)}>{t('recurring.actions.generate')}</Button>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('recurring.empty')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">{t('recurring.table.client')}</th>
              <th className="py-2 pr-4">{t('recurring.table.period')}</th>
              <th className="py-2 pr-4">{t('recurring.table.due_date')}</th>
              <th className="py-2 pr-4">{t('recurring.table.total')}</th>
              <th className="py-2 pr-4">{t('recurring.table.paid')}</th>
              <th className="py-2 pr-4">{t('recurring.table.status')}</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b">
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-2">
                    {inv.client?.name}
                    <BlockBadge clientId={inv.client_id} />
                  </span>
                </td>
                <td className="py-2 pr-4">{inv.period}</td>
                <td className="py-2 pr-4">{inv.due_date}</td>
                <td className="py-2 pr-4">€{Number(inv.total_amount).toFixed(2)}</td>
                <td className="py-2 pr-4">€{Number(inv.amount_paid).toFixed(2)}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      inv.status === 'paid'
                        ? 'bg-emerald-100 text-emerald-700'
                        : inv.status === 'overdue'
                        ? 'bg-red-100 text-red-700'
                        : inv.status === 'partial'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {t(`recurring.status.${inv.status}`)}
                  </span>
                </td>
                <td className="py-2">
                  <Button variant="link" size="sm" onClick={() => setDetailId(inv.id)}>
                    {t('recurring.actions.view')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <GenerateInvoicesDialog open={genOpen} onOpenChange={setGenOpen} />
      {detailId && (
        <InvoiceDetailDialog
          invoiceId={detailId}
          open={!!detailId}
          onOpenChange={(o) => !o && setDetailId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add route**

```tsx
import { AccountingRecurringPage } from '@/features/billing/AccountingRecurringPage';
// inside ShellLayout's children → accounting children:
{ path: 'recurring', element: <AccountingRecurringPage /> },
```

- [ ] **Step 3: Sidebar — add Recurring link inside `{isAccounting && (...)}` block**

```tsx
<NavLink
  to="/accounting/recurring"
  className={({ isActive }) =>
    `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
  }
>
  {t('accounting:recurring.title')}
</NavLink>
```

- [ ] **Step 4: Gates + commit**

(GenerateInvoicesDialog and InvoiceDetailDialog don't exist yet — add stubs first to avoid typecheck failures.)

Stub `src/features/billing/GenerateInvoicesDialog.tsx`:
```tsx
type Props = { open: boolean; onOpenChange: (v: boolean) => void };
export function GenerateInvoicesDialog(_p: Props) { return null; }
```

Stub `src/features/billing/InvoiceDetailDialog.tsx`:
```tsx
type Props = { invoiceId: string; open: boolean; onOpenChange: (v: boolean) => void };
export function InvoiceDetailDialog(_p: Props) { return null; }
```

(Tasks 10 + 11 fill these in.)

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(billing): /accounting/recurring page + sidebar nav (dialogs stubbed)"
git push
```

---

## Task 10 — GenerateInvoicesDialog

**Files:**
- Modify: `src/features/billing/GenerateInvoicesDialog.tsx` (replace stub)

- [ ] **Step 1: Replace stub**

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useGenerateMonthlyInvoices } from './hooks/useGenerateMonthlyInvoices';

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function GenerateInvoicesDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('accounting');
  const generate = useGenerateMonthlyInvoices();
  const [period, setPeriod] = useState(defaultPeriod());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      alert(t('recurring.generate.errors.invalid_period_format'));
      return;
    }
    try {
      const result = await generate.mutateAsync(period);
      alert(t('recurring.generate.success', { count: result.count, period: result.period }));
      onOpenChange(false);
    } catch (err) {
      const msg = (err as Error).message;
      alert(t(`recurring.generate.errors.${msg}`, { defaultValue: msg }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recurring.generate.dialog_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="period">{t('recurring.generate.period_label')}</Label>
            <Input
              id="period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-05"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={generate.isPending}>
              {generate.isPending ? t('recurring.generate.submitting') : t('recurring.generate.submit')}
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
echo "exit: $?"
git add -A
git commit -m "feat(billing): GenerateInvoicesDialog with period validation + RPC call"
git push
```

---

## Task 11 — InvoiceDetailDialog with line items + mark-paid

**Files:**
- Modify: `src/features/billing/InvoiceDetailDialog.tsx` (replace stub)

- [ ] **Step 1: Replace stub**

```tsx
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMonthlyInvoice } from './hooks/useMonthlyInvoice';
import { useMarkInvoicePaid } from './hooks/useMarkInvoicePaid';

type Props = { invoiceId: string; open: boolean; onOpenChange: (v: boolean) => void };

export function InvoiceDetailDialog({ invoiceId, open, onOpenChange }: Props) {
  const { t } = useTranslation('accounting');
  const { data: invoice, isLoading } = useMonthlyInvoice(invoiceId);
  const markPaid = useMarkInvoicePaid();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {invoice ? `${invoice.client?.name} — ${invoice.period}` : '…'}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !invoice ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          <div className="space-y-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">{t('recurring.items.service')}</th>
                  <th className="py-2 pr-4">{t('recurring.items.description')}</th>
                  <th className="py-2 pr-4 text-right">{t('recurring.items.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-2 pr-4">{it.service_type}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{it.description}</td>
                    <td className="py-2 pr-4 text-right">€{Number(it.amount).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2 pr-4" colSpan={2}>
                    {t('recurring.table.total')}
                  </td>
                  <td className="py-2 pr-4 text-right">€{Number(invoice.total_amount).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">{t('recurring.table.paid')}: </span>
                €{Number(invoice.amount_paid).toFixed(2)} ({t(`recurring.status.${invoice.status}`)})
              </div>
              {invoice.status !== 'paid' && (
                <Button
                  onClick={() =>
                    void markPaid.mutateAsync({
                      id: invoice.id,
                      total: Number(invoice.total_amount),
                    })
                  }
                  disabled={markPaid.isPending}
                >
                  {t('recurring.actions.mark_paid')}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(billing): InvoiceDetailDialog — line items + mark-paid"
git push
```

---

# Sub-phase D — Acceptance (Tasks 12–13)

## Task 12 — E2E recurring smoke spec

**Files:**
- Create: `tests/recurring-smoke.spec.ts`

- [ ] **Step 1: Spec**

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

test.describe('recurring smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /accounting/recurring', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page).toHaveURL(/\/accounting\/recurring$/);
    await expect(
      page.getByRole('heading', { name: /recurring billing|επαναλαμβανόμενη/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /generate invoices|δημιουργία τιμολογίων/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add tests/recurring-smoke.spec.ts
git commit -m "test(e2e): recurring smoke — accounting recurring page renders"
git push
```

---

## Task 13 — Phase 5 acceptance + manual smoke

- [ ] **Step 1: Local + e2e**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
```

All exit 0.

- [ ] **Step 2: Phase 5 acceptance criteria**

- [ ] Admin navigates to `/accounting/recurring`. Initially empty.
- [ ] Click "Generate invoices" → period defaults to current YYYY-MM → submit → success message with count.
- [ ] List populates with one row per client that has active recurring jobs.
- [ ] Click "View" on a row → dialog shows line items per service + total + mark-paid button.
- [ ] Mark paid → status flips to "Paid", row badge turns green.
- [ ] Block a client (from `/clients/:id` → "Block client" button → enter reason → submit). The red badge appears on the client detail and in the clients list.
- [ ] Try to drag any of that client's job cards on a tech kanban (Phase 6 will surface this UI; for now use Supabase SQL Editor):
  ```sql
  update public.jobs set stage_id = (select id from pipeline_stages where board='web_seo' and code='active') where client_id = '<blocked client id>' and service_type = 'web_seo';
  ```
  Expect: error `client_blocked` (raised by trigger).
- [ ] Unblock the client → badge disappears → stage moves now succeed.
- [ ] Greek translations work on all new pages.

- [ ] **Step 3: Manual smoke (USER ACTION)**

Walk through the items above at https://itdevcrm.vercel.app. Tell me anything broken.

- [ ] **Step 4: Mark Phase 5 done**

No further commit needed.

---

## Out of scope for Phase 5 (do NOT do now)

- **Tech sub-departments × 4 kanbans** — Phase 6 (jobs already get spawned at accounting completion, but their kanban UIs are Phase 6).
- **Per-job billing tracking** — invoices are consolidated per client per month per spec Q9B=i.
- **Auto-generation cron for monthly invoices** — manual generation per spec Q9C=i. The pg_cron job in Task 2 handles only `mark_overdue_invoices`.
- **Accounting recurring view's "tech project status" column** — covered in Phase 6 once tech kanbans are alive (admin can query jobs.stage from there).
- **Invoice PDF generation** — Phase 8 polish.
- **Email notifications when invoice goes overdue** — Phase 8.

If a task starts touching any of the above, stop and revisit.
