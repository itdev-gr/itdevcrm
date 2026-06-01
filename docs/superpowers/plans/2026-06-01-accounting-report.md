# Accounting Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully detailed accounting report at `/accounting/report` that shows incomes (from paid `deal_payments`) and expenses (from a new `expenses` table) with VAT split, supporting one-time / recurring-monthly / recurring-yearly entries, drilldowns, CSV + PDF export, all admin-only.

**Architecture:** New `expense_categories` + `expenses` tables; recurrence engine `ensure_recurring_expenses()` wired to the existing daily cron; VAT columns added to `deal_payments` with backfill; two Postgres views (`accounting_ledger_v` + `accounting_pl_summary_v`) unify income + expense data; new React feature `src/features/accounting_report/` containing hooks, components, two pages; routes guarded by `AdminGuard`.

**Tech Stack:** Supabase (Postgres + Auth + Storage + Realtime), React 18 + Vite, TanStack Query, Tailwind + shadcn/ui, react-i18next, react-router, Vitest + Playwright, jsPDF (or existing PDF lib if present).

**Reference spec:** `docs/superpowers/specs/2026-06-01-accounting-report-design.md`

---

## File Structure

**New DB migrations** (under `supabase/migrations/`):
- `20260601000001_expense_categories.sql` — table + seed + RLS + trigger.
- `20260601000002_expenses.sql` — table + generated columns + indexes + RLS + activity trigger.
- `20260601000003_expense_receipts_bucket.sql` — Storage bucket + policies.
- `20260601000004_ensure_recurring_expenses.sql` — function + grant.
- `20260601000005_deal_payments_vat.sql` — VAT columns + backfill + updated `seed_deal_payments` + updated `ensure_recurring_payments`.
- `20260601000006_accounting_ledger_view.sql` — `accounting_ledger_v`.
- `20260601000007_accounting_pl_summary_view.sql` — `accounting_pl_summary_v`.
- `20260601000008_recurring_expenses_daily_cron.sql` — extend existing daily cron.

**New DB tests** (under `supabase/tests/`):
- `expense_categories_seed.sql`
- `expenses_rls.sql`
- `expenses_generated_columns.sql`
- `expenses_check_constraints.sql`
- `ensure_recurring_expenses.sql`
- `deal_payments_vat_backfill.sql`
- `accounting_ledger_v.sql`

**New frontend feature** (under `src/features/accounting_report/`):
- `hooks/useExpenseCategories.ts` (+ test)
- `hooks/useExpenses.ts` (+ test)
- `hooks/useExpensesRealtime.ts`
- `hooks/useLedger.ts` (+ test)
- `hooks/usePLSummary.ts` (+ test)
- `hooks/useCreateExpense.ts` (+ test)
- `hooks/useUpdateExpense.ts` (+ test)
- `hooks/useMarkExpensePaid.ts` (+ test)
- `hooks/useDeleteExpense.ts` (+ test)
- `hooks/useUploadReceipt.ts` (+ test)
- `components/ExpenseRow.tsx`
- `components/NewExpenseDialog.tsx` (+ test)
- `components/ExpenseDetailDialog.tsx` (+ test)
- `components/TransactionDrawer.tsx`
- `components/IncomeBreakdown.tsx`
- `components/ExpenseBreakdown.tsx`
- `components/ReportHeader.tsx`
- `components/ExportMenu.tsx` (+ test)
- `utils/formatRange.ts` (+ test)
- `utils/exportCSV.ts` (+ test)
- `utils/exportPDF.ts`
- `ReportPage.tsx` (+ test)
- `ExpensesPage.tsx`

**Modified frontend files:**
- `src/lib/queryKeys.ts` — append new keys.
- `src/i18n/locales/en/accounting_report.json` (new).
- `src/i18n/locales/el/accounting_report.json` (new).
- `src/lib/i18n.ts` — register the new namespace.
- `src/app/router.tsx` — register the two new lazy routes under `accounting`, switch the guard to admin-only for them.
- `src/components/layout/Sidebar.tsx` — add Report + Expenses entries (admin-only).
- `src/features/deals/hooks/useDealPayments.ts` — accept `amountNet` + `vatRate` instead of `amount`.
- `src/features/deals/components/<DealPaymentsTab>.tsx` (wherever the payment table lives — verify in Task 31) — show Net / VAT / Gross triplet.

---

## Tasks

### Task 1: Migration — `expense_categories` table

**Files:**
- Create: `supabase/migrations/20260601000001_expense_categories.sql`
- Create: `supabase/tests/expense_categories_seed.sql`

- [ ] **Step 1: Write the failing DB test**

```sql
-- supabase/tests/expense_categories_seed.sql
begin;
select plan(3);

select has_table('public', 'expense_categories', 'expense_categories table exists');

select is(
  (select count(*)::int from public.expense_categories),
  15,
  '15 categories seeded'
);

select results_eq(
  $$ select key from public.expense_categories order by sort_order $$,
  $$ values
       ('salaries'),('freelancers'),('rent'),('utilities'),('software'),
       ('hosting_domains'),('ads_spend'),('equipment'),('taxes_vat'),
       ('accountant_fees'),('bank_fees'),('marketing'),('training'),
       ('travel'),('other')
  $$,
  'seeded keys are in expected order'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db expense_categories_seed`
Expected: FAIL — table does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260601000001_expense_categories.sql
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name_en text not null,
  name_el text not null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

alter table public.expense_categories enable row level security;

create policy expense_categories_select on public.expense_categories
  for select to authenticated using (true);

create policy expense_categories_mutate on public.expense_categories
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

insert into public.expense_categories (key, name_en, name_el, sort_order) values
  ('salaries',        'Salaries',          'Μισθοί',                          10),
  ('freelancers',     'Freelancers',       'Εξωτερικοί συνεργάτες',           20),
  ('rent',            'Rent',              'Ενοίκιο',                         30),
  ('utilities',       'Utilities',         'Λογαριασμοί κοινής ωφέλειας',     40),
  ('software',        'Software',          'Λογισμικό',                       50),
  ('hosting_domains', 'Hosting & Domains', 'Φιλοξενία & Domains',             60),
  ('ads_spend',       'Ads spend',         'Διαφημιστική δαπάνη',             70),
  ('equipment',       'Equipment',         'Εξοπλισμός',                      80),
  ('taxes_vat',       'Taxes / VAT',       'Φόροι / ΦΠΑ',                     90),
  ('accountant_fees', 'Accountant fees',   'Λογιστικά',                      100),
  ('bank_fees',       'Bank fees',         'Τραπεζικά έξοδα',                110),
  ('marketing',       'Marketing',         'Marketing',                      120),
  ('training',        'Training',          'Εκπαίδευση',                     130),
  ('travel',          'Travel',            'Μετακινήσεις',                   140),
  ('other',           'Other',             'Άλλο',                           150);

-- ROLLBACK:
-- drop table if exists public.expense_categories cascade;
```

- [ ] **Step 4: Push the migration**

Run: `supabase db push`
Expected: applied successfully.

- [ ] **Step 5: Re-run the DB test**

Run: `supabase test db expense_categories_seed`
Expected: PASS (3 of 3).

- [ ] **Step 6: Regen TypeScript types**

Run: `npm run types:gen`
Expected: `src/types/supabase.ts` now contains `expense_categories`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260601000001_expense_categories.sql \
        supabase/tests/expense_categories_seed.sql \
        src/types/supabase.ts
git commit -m "$(cat <<'EOF'
feat(db): expense_categories table + 15-row seed

Admin-only writes, all authenticated reads (labels need to render
in dropdowns without leaking spend data). Archive flag preserves
historical category names on old expense rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration — `expenses` table

**Files:**
- Create: `supabase/migrations/20260601000002_expenses.sql`
- Create: `supabase/tests/expenses_generated_columns.sql`
- Create: `supabase/tests/expenses_check_constraints.sql`
- Create: `supabase/tests/expenses_rls.sql`

- [ ] **Step 1: Write the failing generated-columns test**

```sql
-- supabase/tests/expenses_generated_columns.sql
begin;
select plan(4);

-- Need a category to FK against.
insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_gen', 'X', 'X', 999)
  on conflict (key) do nothing;

with new_row as (
  insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, created_by)
    select id, 'one_time', 100.00, 24.00, '2026-06-01', null
      from public.expense_categories where key = '__test_gen'
    returning vat_amount, amount_gross
)
select is(vat_amount, 24.00::numeric, 'vat_amount = 24 for net=100, rate=24') from new_row;

with new_row as (
  select vat_amount, amount_gross from public.expenses
  where amount_net = 100.00 order by created_at desc limit 1
)
select is(amount_gross, 124.00::numeric, 'amount_gross = 124 for net=100, rate=24') from new_row;

update public.expenses
  set amount_net = 200.00
  where amount_net = 100.00
    and category_id = (select id from public.expense_categories where key = '__test_gen');

select is(
  (select vat_amount from public.expenses
   where amount_net = 200.00
     and category_id = (select id from public.expense_categories where key = '__test_gen')),
  48.00::numeric,
  'vat_amount recomputes on net update'
);

select is(
  (select amount_gross from public.expenses
   where amount_net = 200.00
     and category_id = (select id from public.expense_categories where key = '__test_gen')),
  248.00::numeric,
  'amount_gross recomputes on net update'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Write the failing check-constraints test**

```sql
-- supabase/tests/expenses_check_constraints.sql
begin;
select plan(5);

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_cc', 'X', 'X', 998) on conflict (key) do nothing;

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, status)
       select id, 'one_time', 10, 24, '2026-06-01', 'paid'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'paid without paid_at rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, status, paid_at)
       select id, 'one_time', 10, 24, '2026-06-01', 'paid', now()
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'paid without payment_method rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date)
       select id, 'one_time', -1, 24, '2026-06-01'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'negative amount_net rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date)
       select id, 'one_time', 10, 150, '2026-06-01'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'vat_rate > 100 rejected'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, end_date)
       select id, 'one_time', 10, 24, '2026-06-10', '2026-06-01'
         from public.expense_categories where key = '__test_cc' $$,
  '23514',
  null,
  'end_date before start_date rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Write the failing RLS test**

```sql
-- supabase/tests/expenses_rls.sql
begin;
select plan(2);

-- Switch to a non-admin role (authenticated but not admin).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated"}';

select is(
  (select count(*)::int from public.expenses),
  0,
  'non-admin sees zero expense rows'
);

select throws_ok(
  $$ insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date)
       select id, 'one_time', 10, 24, current_date
         from public.expense_categories limit 1 $$,
  '42501',
  null,
  'non-admin cannot insert expenses'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `supabase test db expenses_generated_columns expenses_check_constraints expenses_rls`
Expected: all FAIL (table does not exist).

- [ ] **Step 5: Write the migration**

```sql
-- supabase/migrations/20260601000002_expenses.sql
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  vendor text,
  billing_type text not null check (billing_type in ('one_time','recurring_monthly','recurring_yearly')),
  amount_net numeric(12,2) not null check (amount_net >= 0),
  vat_rate numeric(5,2) not null default 24.00 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount numeric(12,2) generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  amount_gross numeric(12,2) generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored,
  start_date date not null,
  end_date date,
  status text not null default 'pending' check (status in ('pending','paid')),
  payment_method text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(user_id),
  notes text,
  receipt_path text,
  parent_expense_id uuid references public.expenses(id) on delete set null,
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_paid_requires_paid_at check (status <> 'paid' or paid_at is not null),
  constraint expenses_paid_requires_method check (status <> 'paid' or payment_method is not null),
  constraint expenses_end_after_start check (end_date is null or end_date >= start_date)
);

create index expenses_status_start on public.expenses (status, start_date desc);
create index expenses_category_start on public.expenses (category_id, start_date desc);
create index expenses_recurring_renewal on public.expenses (billing_type, end_date)
  where billing_type in ('recurring_monthly','recurring_yearly');
create index expenses_vendor on public.expenses (vendor);
create index expenses_parent on public.expenses (parent_expense_id);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create trigger expenses_activity
  after insert or update or delete on public.expenses
  for each row execute function public.log_activity('id');

alter table public.expenses enable row level security;

create policy expenses_all on public.expenses
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ROLLBACK:
-- drop table if exists public.expenses cascade;
```

- [ ] **Step 6: Push the migration**

Run: `supabase db push`
Expected: applied successfully.

- [ ] **Step 7: Re-run the DB tests**

Run: `supabase test db expenses_generated_columns expenses_check_constraints expenses_rls`
Expected: all PASS.

- [ ] **Step 8: Regen TypeScript types**

Run: `npm run types:gen`

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260601000002_expenses.sql \
        supabase/tests/expenses_generated_columns.sql \
        supabase/tests/expenses_check_constraints.sql \
        supabase/tests/expenses_rls.sql \
        src/types/supabase.ts
git commit -m "$(cat <<'EOF'
feat(db): expenses table with VAT generated columns + admin RLS

Stores one-time and recurring (monthly / yearly) expenses with
amount_net + vat_rate + generated vat_amount + amount_gross.
parent_expense_id self-FK identifies recurrence chains. RLS is
admin-only. Activity log trigger captures every insert / update /
delete for audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration — `expense-receipts` Storage bucket

**Files:**
- Create: `supabase/migrations/20260601000003_expense_receipts_bucket.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260601000003_expense_receipts_bucket.sql
insert into storage.buckets (id, name, public)
  values ('expense-receipts', 'expense-receipts', false)
  on conflict (id) do nothing;

create policy expense_receipts_all on storage.objects
  for all to authenticated
  using (bucket_id = 'expense-receipts' and public.current_user_is_admin())
  with check (bucket_id = 'expense-receipts' and public.current_user_is_admin());

-- ROLLBACK:
-- drop policy if exists expense_receipts_all on storage.objects;
-- delete from storage.buckets where id = 'expense-receipts';
```

- [ ] **Step 2: Push the migration**

Run: `supabase db push`
Expected: applied successfully.

- [ ] **Step 3: Manually verify**

In Supabase Studio: Storage → confirm `expense-receipts` bucket exists, private. SQL editor:

```sql
select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname = 'expense_receipts_all';
```

Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260601000003_expense_receipts_bucket.sql
git commit -m "feat(db): private expense-receipts storage bucket (admin-only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Migration — `ensure_recurring_expenses()` function

**Files:**
- Create: `supabase/migrations/20260601000004_ensure_recurring_expenses.sql`
- Create: `supabase/tests/ensure_recurring_expenses.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/ensure_recurring_expenses.sql
begin;
select plan(5);

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_rec', 'X', 'X', 997) on conflict (key) do nothing;

-- A recurring_monthly row with end_date 3 days in the future.
with src as (
  insert into public.expenses (category_id, vendor, billing_type, amount_net, vat_rate, start_date, end_date)
    select id, 'Acme', 'recurring_monthly', 50, 24, current_date, current_date + interval '3 days'
      from public.expense_categories where key = '__test_rec'
    returning id
)
select id as chain_root from src \gset

select is(public.ensure_recurring_expenses(), 1, 'first call creates one successor');
select is(public.ensure_recurring_expenses(), 0, 'second call is idempotent');

select is(
  (select count(*)::int from public.expenses
    where parent_expense_id = :'chain_root'),
  1,
  'successor has parent_expense_id = chain root'
);

-- A second independent recurring_monthly row with same vendor + category.
with second as (
  insert into public.expenses (category_id, vendor, billing_type, amount_net, vat_rate, start_date, end_date)
    select id, 'Acme', 'recurring_monthly', 80, 24, current_date, current_date + interval '4 days'
      from public.expense_categories where key = '__test_rec'
    returning id
)
select id as second_chain from second \gset

select is(public.ensure_recurring_expenses(), 1, 'second independent chain renews independently');

-- One-time rows must never be extended.
insert into public.expenses (category_id, billing_type, amount_net, vat_rate, start_date, end_date)
  select id, 'one_time', 10, 24, current_date, current_date + interval '1 day'
    from public.expense_categories where key = '__test_rec';

select is(
  (select count(*)::int from public.expenses
    where billing_type = 'one_time'
      and category_id = (select id from public.expense_categories where key = '__test_rec')),
  1,
  'one_time row not extended after another renewal call'
);

-- Trigger a renewal to confirm the previous count assertion.
select public.ensure_recurring_expenses();

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db ensure_recurring_expenses`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260601000004_ensure_recurring_expenses.sql
create or replace function public.ensure_recurring_expenses()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select e.*
      from public.expenses e
     where e.billing_type in ('recurring_monthly','recurring_yearly')
       and e.end_date is not null
       and e.end_date <= current_date + interval '7 days'
       and not exists (
         select 1 from public.expenses e2
          where coalesce(e2.parent_expense_id, e2.id)
              = coalesce(e.parent_expense_id, e.id)
            and e2.start_date >= e.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.expenses
      (category_id, vendor, billing_type, amount_net, vat_rate,
       start_date, end_date, status, notes, parent_expense_id, created_by)
      values
      (r.category_id, r.vendor, r.billing_type, r.amount_net, r.vat_rate,
       next_start, next_end, 'pending', r.notes,
       coalesce(r.parent_expense_id, r.id), r.created_by);

    created := created + 1;
  end loop;
  return created;
end $$;

grant execute on function public.ensure_recurring_expenses() to authenticated;

-- ROLLBACK:
-- drop function if exists public.ensure_recurring_expenses();
```

- [ ] **Step 4: Push the migration**

Run: `supabase db push`

- [ ] **Step 5: Re-run the test**

Run: `supabase test db ensure_recurring_expenses`
Expected: PASS (5 of 5).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260601000004_ensure_recurring_expenses.sql \
        supabase/tests/ensure_recurring_expenses.sql
git commit -m "$(cat <<'EOF'
feat(db): ensure_recurring_expenses() auto-extends recurring chains

Mirrors ensure_recurring_payments(). Idempotent guard via
parent_expense_id chain root. One-time rows never extended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migration — `deal_payments` VAT columns + backfill

**Files:**
- Create: `supabase/migrations/20260601000005_deal_payments_vat.sql`
- Create: `supabase/tests/deal_payments_vat_backfill.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/deal_payments_vat_backfill.sql
begin;
select plan(2);

select is(
  (select count(*)::int from public.deal_payments
     where amount is not null
       and abs(amount_gross - amount) > 0.02),
  0,
  'every legacy amount within €0.02 of generated amount_gross'
);

select is(
  (select round(sum(amount_net + vat_amount), 2)
     from public.deal_payments),
  (select round(sum(amount_gross), 2)
     from public.deal_payments),
  'sum(net + vat) = sum(gross) for the whole table'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db deal_payments_vat_backfill`
Expected: FAIL — column `amount_net` / `amount_gross` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260601000005_deal_payments_vat.sql
alter table public.deal_payments
  add column if not exists amount_net numeric(12,2),
  add column if not exists vat_rate numeric(5,2) not null default 24.00,
  add column if not exists vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column if not exists amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- Country-aware backfill: GR clients are billed at 24% VAT (existing `amount`
-- is gross), every other country is billed at 0% (existing `amount` is already
-- net). Confirmed against live data on 2026-06-01: 7 GR clients + 1 CY client.
update public.deal_payments dp
  set amount_net = case
        when c.country = 'Greece' then round(dp.amount / 1.24, 2)
        else dp.amount
      end,
      vat_rate = case
        when c.country = 'Greece' then 24.00
        else 0.00
      end
  from public.deals d
  join public.clients c on c.id = d.client_id
  where d.id = dp.deal_id
    and dp.amount_net is null
    and dp.amount is not null;

alter table public.deal_payments
  alter column amount_net set not null;

alter table public.deal_payments
  add constraint deal_payments_amount_net_nonneg check (amount_net >= 0),
  add constraint deal_payments_vat_rate_bounded check (vat_rate >= 0 and vat_rate <= 100);

comment on column public.deal_payments.amount is
  'DEPRECATED: gross amount. Read amount_gross instead. Will be dropped after 2026-07-01.';

-- Log any mismatched rows for manual review.
do $$
declare mismatched int;
begin
  select count(*) into mismatched
  from public.deal_payments
  where amount is not null
    and abs(amount_gross - amount) > 0.02;
  if mismatched > 0 then
    raise notice 'deal_payments VAT backfill: % rows differ from legacy amount by >€0.02', mismatched;
  end if;
end $$;

-- Updated seed_deal_payments writes amount_net instead of amount.
create or replace function public.seed_deal_payments(target_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d record;
  svc jsonb;
  idx int := 0;
  s_start date;
  s_end date;
  gross numeric(12,2);
  net numeric(12,2);
  vat numeric(5,2) := 24.00;
  bt text;
  st text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    bt := coalesce(svc->>'billing_type', 'one_time');
    st := svc->>'service_type';
    if bt = 'one_time' then
      gross := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      s_end := s_start;
    elsif bt = 'recurring_monthly' then
      gross := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 month';
    elsif bt = 'recurring_yearly' then
      gross := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 year';
    else
      gross := 0; s_end := s_start;
    end if;

    net := round(gross / (1 + vat / 100), 2);

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (d.id, st, idx, bt, net, vat, s_start, s_end);

    idx := idx + 1;
  end loop;
end $$;

-- Updated ensure_recurring_payments writes amount_net + vat_rate.
create or replace function public.ensure_recurring_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.end_date is not null
       and dp.end_date <= current_date + interval '7 days'
       and d.archived = false
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_index = dp.service_index
            and dp2.start_date >= dp.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end);

    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK:
-- alter table public.deal_payments
--   drop constraint if exists deal_payments_amount_net_nonneg,
--   drop constraint if exists deal_payments_vat_rate_bounded,
--   drop column if exists amount_net,
--   drop column if exists vat_rate,
--   drop column if exists vat_amount,
--   drop column if exists amount_gross;
-- (seed_deal_payments + ensure_recurring_payments must be reverted to the pre-migration definitions
--  from 20260503000010_deal_payments.sql.)
```

- [ ] **Step 4: Push the migration**

Run: `supabase db push`
Expected: applied; watch psql output for the `raise notice` line — note any row count > 0.

- [ ] **Step 5: Re-run the test**

Run: `supabase test db deal_payments_vat_backfill`
Expected: PASS (2 of 2).

- [ ] **Step 6: Regen TypeScript types**

Run: `npm run types:gen`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260601000005_deal_payments_vat.sql \
        supabase/tests/deal_payments_vat_backfill.sql \
        src/types/supabase.ts
git commit -m "$(cat <<'EOF'
feat(db): deal_payments amount_net + vat_rate + generated vat/gross

Brings income onto the same VAT footing as the new expenses table.
Backfill assumes the existing amount column held gross at the
Greek 24% standard. Legacy amount stays nullable + commented as
deprecated for one release as a safety net.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migration — `accounting_ledger_v` view

**Files:**
- Create: `supabase/migrations/20260601000006_accounting_ledger_view.sql`
- Create: `supabase/tests/accounting_ledger_v.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/accounting_ledger_v.sql
begin;
select plan(3);

select has_view('public', 'accounting_ledger_v', 'view exists');

insert into public.expense_categories (key, name_en, name_el, sort_order)
  values ('__test_ledger', 'X', 'X', 996) on conflict (key) do nothing;

insert into public.expenses
  (category_id, vendor, billing_type, amount_net, vat_rate, start_date, status, payment_method, paid_at)
  select id, 'Vendor X', 'one_time', 100, 24, '2026-06-15', 'paid', 'bank_transfer', '2026-06-15T10:00:00Z'
    from public.expense_categories where key = '__test_ledger';

select is(
  (select count(*)::int from public.accounting_ledger_v
    where direction = 'out' and counterparty = 'Vendor X' and period = '2026-06'),
  1,
  'paid expense surfaces in ledger view'
);

select is(
  (select amount_gross from public.accounting_ledger_v
    where counterparty = 'Vendor X' and period = '2026-06'),
  124.00::numeric,
  'amount_gross propagates from generated column'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase test db accounting_ledger_v`
Expected: FAIL — view does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260601000006_accounting_ledger_view.sql
create or replace view public.accounting_ledger_v
with (security_invoker = true) as
select
  'in'::text       as direction,
  coalesce(dp.paid_at::date, dp.start_date) as event_date,
  to_char(coalesce(dp.paid_at::date, dp.start_date), 'YYYY-MM') as period,
  dp.status,
  dp.amount_net,
  dp.vat_amount,
  dp.amount_gross,
  dp.service_type as category_key,
  c.name          as counterparty,
  dp.billing_type,
  'deal_payments'::text as source_table,
  dp.id           as source_id
from public.deal_payments dp
join public.deals d on d.id = dp.deal_id
join public.clients c on c.id = d.client_id

union all

select
  'out'::text,
  coalesce(e.paid_at::date, e.start_date),
  to_char(coalesce(e.paid_at::date, e.start_date), 'YYYY-MM'),
  e.status,
  e.amount_net,
  e.vat_amount,
  e.amount_gross,
  cat.key,
  e.vendor,
  e.billing_type,
  'expenses'::text,
  e.id
from public.expenses e
join public.expense_categories cat on cat.id = e.category_id;

-- ROLLBACK:
-- drop view if exists public.accounting_ledger_v;
```

- [ ] **Step 4: Push the migration**

Run: `supabase db push`

- [ ] **Step 5: Re-run the test**

Run: `supabase test db accounting_ledger_v`
Expected: PASS (3 of 3).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260601000006_accounting_ledger_view.sql \
        supabase/tests/accounting_ledger_v.sql
git commit -m "feat(db): accounting_ledger_v unifies income + expenses

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Migration — `accounting_pl_summary_v` view

**Files:**
- Create: `supabase/migrations/20260601000007_accounting_pl_summary_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260601000007_accounting_pl_summary_view.sql
create or replace view public.accounting_pl_summary_v
with (security_invoker = true) as
select
  period,
  sum(case when direction = 'in'  and status = 'paid' then amount_net   else 0 end) as total_income_net,
  sum(case when direction = 'in'  and status = 'paid' then vat_amount   else 0 end) as total_income_vat,
  sum(case when direction = 'in'  and status = 'paid' then amount_gross else 0 end) as total_income_gross,
  sum(case when direction = 'out' and status = 'paid' then amount_net   else 0 end) as total_expense_net,
  sum(case when direction = 'out' and status = 'paid' then vat_amount   else 0 end) as total_expense_vat,
  sum(case when direction = 'out' and status = 'paid' then amount_gross else 0 end) as total_expense_gross,
  sum(case when direction = 'in'  and status = 'paid' then amount_net   else 0 end)
    - sum(case when direction = 'out' and status = 'paid' then amount_net   else 0 end) as net_profit_net,
  sum(case when direction = 'in'  and status = 'paid' then amount_gross else 0 end)
    - sum(case when direction = 'out' and status = 'paid' then amount_gross else 0 end) as net_profit_gross
from public.accounting_ledger_v
group by period;

-- ROLLBACK:
-- drop view if exists public.accounting_pl_summary_v;
```

- [ ] **Step 2: Push the migration**

Run: `supabase db push`

- [ ] **Step 3: Manually verify**

```sql
select * from public.accounting_pl_summary_v limit 5;
```

Expected: returns rows for any period where there's at least one paid `deal_payment` or paid `expense`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260601000007_accounting_pl_summary_view.sql
git commit -m "feat(db): accounting_pl_summary_v period totals

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Migration — extend daily cron to renew expenses

**Files:**
- Create: `supabase/migrations/20260601000008_recurring_expenses_daily_cron.sql`

Find the existing cron entry first: `grep -rn "ensure_recurring_payments_daily\|schedule.*ensure_recurring" supabase/migrations/`. The previous registration is in `20260503000014_ensure_recurring_payments_daily_cron.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260601000008_recurring_expenses_daily_cron.sql
-- Replace the existing daily renewal job so it calls both functions in one tick.
select cron.unschedule('ensure-recurring-payments-daily')
  where exists (select 1 from cron.job where jobname = 'ensure-recurring-payments-daily');

select cron.schedule(
  'ensure-recurring-renewals-daily',
  '0 3 * * *',
  $$ select public.ensure_recurring_payments(); select public.ensure_recurring_expenses(); $$
);

-- ROLLBACK:
-- select cron.unschedule('ensure-recurring-renewals-daily')
--   where exists (select 1 from cron.job where jobname = 'ensure-recurring-renewals-daily');
-- select cron.schedule('ensure-recurring-payments-daily', '0 3 * * *', $$ select public.ensure_recurring_payments(); $$);
```

> **Note:** If the existing cron entry has a different name or schedule, adjust both calls above to match — verify with `select jobname, schedule, command from cron.job;` before running.

- [ ] **Step 2: Push the migration**

Run: `supabase db push`

- [ ] **Step 3: Manually verify**

```sql
select jobname, schedule, command from cron.job where jobname like '%ensure-recurring%';
```

Expected: one row, `ensure-recurring-renewals-daily`, schedule `0 3 * * *`, command calling both functions.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260601000008_recurring_expenses_daily_cron.sql
git commit -m "feat(db): daily cron now renews recurring expenses too

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: i18n keys (EN + EL)

**Files:**
- Create: `src/i18n/locales/en/accounting_report.json`
- Create: `src/i18n/locales/el/accounting_report.json`
- Modify: `src/lib/i18n.ts` — register the new namespace.

- [ ] **Step 1: Inspect the existing i18n config**

Run: `cat src/lib/i18n.ts | head -80`

Find the `resources` block and the namespace list. The pattern is: each JSON file in `locales/{lang}/<ns>.json` is registered as a namespace; the namespace name matches the file basename.

- [ ] **Step 2: Create the EN file**

```json
// src/i18n/locales/en/accounting_report.json
{
  "page_title": "Accounting Report",
  "page_subtitle": "Income, expenses, and net profit",
  "expenses_page_title": "Expenses",
  "nav": {
    "report": "Report",
    "expenses": "Expenses"
  },
  "range": {
    "this_month": "This month",
    "last_month": "Last month",
    "this_year": "This year",
    "last_year": "Last year",
    "custom": "Custom range",
    "from": "From",
    "to": "To"
  },
  "kpi": {
    "income": "Total income",
    "expense": "Total expenses",
    "net_profit": "Net profit",
    "mrr": "MRR",
    "net_suffix": "net",
    "gross_suffix": "gross",
    "ytd": "YTD"
  },
  "income_breakdown": {
    "title": "Income by service",
    "service": "Service",
    "count": "Count",
    "net": "Net",
    "vat": "VAT",
    "gross": "Gross",
    "percent": "%",
    "unknown": "Unspecified"
  },
  "expense_breakdown": {
    "title": "Expenses by category",
    "category": "Category",
    "count": "Count",
    "net": "Net",
    "vat": "VAT",
    "gross": "Gross",
    "percent": "%",
    "new_expense": "+ New expense"
  },
  "transaction_drawer": {
    "title": "Transactions",
    "close": "Close",
    "date": "Date",
    "counterparty": "Counterparty",
    "billing_type": "Billing",
    "net": "Net",
    "vat": "VAT",
    "gross": "Gross",
    "status": "Status",
    "empty": "No transactions in this slice."
  },
  "expense_form": {
    "create_title": "New expense",
    "edit_title": "Edit expense",
    "category": "Category",
    "category_placeholder": "Select a category",
    "vendor": "Vendor",
    "billing_type": "Billing type",
    "one_time": "One-time",
    "recurring_monthly": "Monthly",
    "recurring_yearly": "Yearly",
    "amount_net": "Amount (net)",
    "vat_rate": "VAT rate (%)",
    "amount_gross": "Gross",
    "start_date": "Start date",
    "end_date": "End date",
    "payment_method": "Payment method",
    "paid_by": "Paid by",
    "notes": "Notes",
    "receipt": "Receipt",
    "upload_receipt": "Upload receipt",
    "view_receipt": "View receipt",
    "submit": "Save",
    "submit_and_mark_paid": "Save & mark paid",
    "cancel": "Cancel",
    "validation": {
      "category_required": "Pick a category.",
      "amount_required": "Net amount is required.",
      "start_date_required": "Start date is required.",
      "end_date_after_start": "End date must be on or after start date.",
      "file_too_large": "File is larger than 10 MB.",
      "file_wrong_type": "Only PDF / PNG / JPEG / WebP are allowed."
    }
  },
  "expense_detail": {
    "title": "Expense",
    "mark_paid": "Mark paid",
    "delete": "Delete",
    "delete_confirm": "Delete this expense? This cannot be undone.",
    "created_by": "Created by",
    "created_at": "Created"
  },
  "expenses_list": {
    "search_placeholder": "Search vendor…",
    "status_all": "All",
    "status_pending": "Pending",
    "status_paid": "Paid",
    "category_all": "All categories",
    "empty": "No expenses match these filters.",
    "bulk_mark_paid": "Mark selected paid"
  },
  "export": {
    "menu": "Export",
    "csv": "Download CSV",
    "pdf": "Download PDF"
  },
  "status": {
    "pending": "Pending",
    "paid": "Paid"
  },
  "errors": {
    "load_failed": "Could not load the report.",
    "save_failed": "Could not save the expense.",
    "delete_failed": "Could not delete the expense.",
    "upload_failed": "Could not upload the receipt."
  }
}
```

- [ ] **Step 3: Create the EL file**

```json
// src/i18n/locales/el/accounting_report.json
{
  "page_title": "Λογιστική Αναφορά",
  "page_subtitle": "Έσοδα, έξοδα και καθαρό κέρδος",
  "expenses_page_title": "Έξοδα",
  "nav": {
    "report": "Αναφορά",
    "expenses": "Έξοδα"
  },
  "range": {
    "this_month": "Αυτός ο μήνας",
    "last_month": "Προηγούμενος μήνας",
    "this_year": "Φέτος",
    "last_year": "Πέρυσι",
    "custom": "Προσαρμοσμένο διάστημα",
    "from": "Από",
    "to": "Έως"
  },
  "kpi": {
    "income": "Σύνολο εσόδων",
    "expense": "Σύνολο εξόδων",
    "net_profit": "Καθαρό κέρδος",
    "mrr": "MRR",
    "net_suffix": "καθαρό",
    "gross_suffix": "μικτό",
    "ytd": "Από αρχή έτους"
  },
  "income_breakdown": {
    "title": "Έσοδα ανά υπηρεσία",
    "service": "Υπηρεσία",
    "count": "Πλήθος",
    "net": "Καθαρό",
    "vat": "ΦΠΑ",
    "gross": "Μικτό",
    "percent": "%",
    "unknown": "Χωρίς κατηγορία"
  },
  "expense_breakdown": {
    "title": "Έξοδα ανά κατηγορία",
    "category": "Κατηγορία",
    "count": "Πλήθος",
    "net": "Καθαρό",
    "vat": "ΦΠΑ",
    "gross": "Μικτό",
    "percent": "%",
    "new_expense": "+ Νέο έξοδο"
  },
  "transaction_drawer": {
    "title": "Συναλλαγές",
    "close": "Κλείσιμο",
    "date": "Ημ/νία",
    "counterparty": "Αντισυμβαλλόμενος",
    "billing_type": "Χρέωση",
    "net": "Καθαρό",
    "vat": "ΦΠΑ",
    "gross": "Μικτό",
    "status": "Κατάσταση",
    "empty": "Καμία συναλλαγή σε αυτή την κατηγορία."
  },
  "expense_form": {
    "create_title": "Νέο έξοδο",
    "edit_title": "Επεξεργασία εξόδου",
    "category": "Κατηγορία",
    "category_placeholder": "Επιλέξτε κατηγορία",
    "vendor": "Προμηθευτής",
    "billing_type": "Τύπος χρέωσης",
    "one_time": "Εφάπαξ",
    "recurring_monthly": "Μηνιαία",
    "recurring_yearly": "Ετήσια",
    "amount_net": "Ποσό (καθαρό)",
    "vat_rate": "Συντελεστής ΦΠΑ (%)",
    "amount_gross": "Μικτό",
    "start_date": "Ημ/νία έναρξης",
    "end_date": "Ημ/νία λήξης",
    "payment_method": "Τρόπος πληρωμής",
    "paid_by": "Πληρώθηκε από",
    "notes": "Σημειώσεις",
    "receipt": "Παραστατικό",
    "upload_receipt": "Μεταφόρτωση παραστατικού",
    "view_receipt": "Προβολή παραστατικού",
    "submit": "Αποθήκευση",
    "submit_and_mark_paid": "Αποθήκευση & σήμανση πληρωμένου",
    "cancel": "Άκυρο",
    "validation": {
      "category_required": "Επιλέξτε κατηγορία.",
      "amount_required": "Το καθαρό ποσό είναι υποχρεωτικό.",
      "start_date_required": "Η ημερομηνία έναρξης είναι υποχρεωτική.",
      "end_date_after_start": "Η ημ/νία λήξης πρέπει να είναι μεταγενέστερη της έναρξης.",
      "file_too_large": "Το αρχείο ξεπερνά τα 10 MB.",
      "file_wrong_type": "Επιτρέπονται μόνο PDF / PNG / JPEG / WebP."
    }
  },
  "expense_detail": {
    "title": "Έξοδο",
    "mark_paid": "Σήμανση ως πληρωμένο",
    "delete": "Διαγραφή",
    "delete_confirm": "Διαγραφή αυτού του εξόδου; Η ενέργεια είναι μη αναστρέψιμη.",
    "created_by": "Δημιουργήθηκε από",
    "created_at": "Δημιουργήθηκε"
  },
  "expenses_list": {
    "search_placeholder": "Αναζήτηση προμηθευτή…",
    "status_all": "Όλα",
    "status_pending": "Εκκρεμή",
    "status_paid": "Πληρωμένα",
    "category_all": "Όλες οι κατηγορίες",
    "empty": "Δεν βρέθηκαν έξοδα με αυτά τα φίλτρα.",
    "bulk_mark_paid": "Σήμανση επιλεγμένων ως πληρωμένα"
  },
  "export": {
    "menu": "Εξαγωγή",
    "csv": "Λήψη CSV",
    "pdf": "Λήψη PDF"
  },
  "status": {
    "pending": "Εκκρεμές",
    "paid": "Πληρωμένο"
  },
  "errors": {
    "load_failed": "Αποτυχία φόρτωσης αναφοράς.",
    "save_failed": "Αποτυχία αποθήκευσης εξόδου.",
    "delete_failed": "Αποτυχία διαγραφής εξόδου.",
    "upload_failed": "Αποτυχία μεταφόρτωσης παραστατικού."
  }
}
```

- [ ] **Step 4: Register the namespace in `src/lib/i18n.ts`**

Add `accounting_report` to whatever array / resources object lists existing namespaces (e.g. `clients`, `deals`, `accounting`). Follow the exact import + resources pattern already in use; do not invent a new mechanism.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en/accounting_report.json \
        src/i18n/locales/el/accounting_report.json \
        src/lib/i18n.ts
git commit -m "feat(i18n): accounting_report namespace (EN + EL)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `queryKeys` additions

**Files:**
- Modify: `src/lib/queryKeys.ts`

- [ ] **Step 1: Append the new keys**

Find the closing `}` of the `queryKeys` object literal and add the entries just before it:

```ts
// src/lib/queryKeys.ts (additions inside the existing object)
  expenseCategories: () => ['expense-categories'] as const,
  expenses: (filters?: Record<string, string | undefined>) =>
    filters ? (['expenses', filters] as const) : (['expenses'] as const),
  expense: (id: string) => ['expense', id] as const,
  accountingLedger: (from: string, to: string) =>
    ['accounting-ledger', from, to] as const,
  accountingPLSummary: (from: string, to: string) =>
    ['accounting-pl-summary', from, to] as const,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queryKeys.ts
git commit -m "feat(query): query keys for expenses + accounting ledger + P&L

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `useExpenseCategories` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useExpenseCategories.ts`
- Create: `src/features/accounting_report/hooks/useExpenseCategories.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useExpenseCategories.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useExpenseCategories } from './useExpenseCategories';

const order = vi.fn();
const eq = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq,
        order,
      })),
    })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useExpenseCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eq.mockReturnValue({ order });
    order.mockResolvedValue({
      data: [
        { id: 'a', key: 'salaries', name_en: 'Salaries', name_el: 'Μισθοί', sort_order: 10 },
        { id: 'b', key: 'rent',     name_en: 'Rent',     name_el: 'Ενοίκιο', sort_order: 30 },
      ],
      error: null,
    });
  });

  it('returns the seeded categories ordered by sort_order, excluding archived', async () => {
    const { result } = renderHook(() => useExpenseCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].key).toBe('salaries');
    expect(eq).toHaveBeenCalledWith('archived', false);
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useExpenseCategories`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useExpenseCategories.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ExpenseCategory = {
  id: string;
  key: string;
  name_en: string;
  name_el: string;
  sort_order: number;
};

export function useExpenseCategories() {
  return useQuery({
    queryKey: queryKeys.expenseCategories(),
    queryFn: async (): Promise<ExpenseCategory[]> => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, key, name_en, name_el, sort_order')
        .eq('archived', false)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useExpenseCategories`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useExpenseCategories.ts \
        src/features/accounting_report/hooks/useExpenseCategories.test.tsx
git commit -m "feat(accounting): useExpenseCategories hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `useExpenses` hook (list with filters)

**Files:**
- Create: `src/features/accounting_report/hooks/useExpenses.ts`
- Create: `src/features/accounting_report/hooks/useExpenses.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useExpenses.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useExpenses } from './useExpenses';

const order = vi.fn();
const lte = vi.fn();
const gte = vi.fn();
const ilike = vi.fn();
const eqStatus = vi.fn();
const eqCategory = vi.fn();
const eqBilling = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.eq = vi.fn((col: string) => {
          if (col === 'status') return eqStatus.mockReturnValue(chain);
          if (col === 'category_id') return eqCategory.mockReturnValue(chain);
          if (col === 'billing_type') return eqBilling.mockReturnValue(chain);
          return chain;
        });
        chain.ilike = ilike.mockReturnValue(chain);
        chain.gte = gte.mockReturnValue(chain);
        chain.lte = lte.mockReturnValue(chain);
        chain.order = order.mockResolvedValue({
          data: [
            { id: 'e1', vendor: 'Adobe', amount_net: 50, amount_gross: 62, status: 'paid' },
          ],
          error: null,
        });
        return chain;
      }),
    })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useExpenses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes filters and orders by start_date desc', async () => {
    const { result } = renderHook(
      () =>
        useExpenses({
          status: 'paid',
          categoryId: 'cat-1',
          vendor: 'ado',
          from: '2026-06-01',
          to: '2026-06-30',
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqStatus).toHaveBeenCalledWith('status', 'paid');
    expect(eqCategory).toHaveBeenCalledWith('category_id', 'cat-1');
    expect(ilike).toHaveBeenCalledWith('vendor', '%ado%');
    expect(gte).toHaveBeenCalledWith('start_date', '2026-06-01');
    expect(lte).toHaveBeenCalledWith('start_date', '2026-06-30');
    expect(order).toHaveBeenCalledWith('start_date', { ascending: false });
    expect(result.current.data?.[0].vendor).toBe('Adobe');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useExpenses`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useExpenses.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ExpenseFilters = {
  status?: 'pending' | 'paid';
  categoryId?: string;
  vendor?: string;
  billingType?: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  from?: string;
  to?: string;
};

export type ExpenseRow = {
  id: string;
  category_id: string;
  vendor: string | null;
  billing_type: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amount_net: number;
  vat_rate: number;
  vat_amount: number;
  amount_gross: number;
  start_date: string;
  end_date: string | null;
  status: 'pending' | 'paid';
  payment_method: string | null;
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  receipt_path: string | null;
  parent_expense_id: string | null;
  created_by: string | null;
  created_at: string;
  category: { key: string; name_en: string; name_el: string } | null;
};

const SELECT = `
  id, category_id, vendor, billing_type,
  amount_net, vat_rate, vat_amount, amount_gross,
  start_date, end_date, status, payment_method, paid_at, paid_by,
  notes, receipt_path, parent_expense_id, created_by, created_at,
  category:expense_categories ( key, name_en, name_el )
`;

export function useExpenses(filters: ExpenseFilters = {}) {
  return useQuery({
    queryKey: queryKeys.expenses(filters as Record<string, string | undefined>),
    queryFn: async (): Promise<ExpenseRow[]> => {
      let q = supabase.from('expenses').select(SELECT);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.categoryId) q = q.eq('category_id', filters.categoryId);
      if (filters.billingType) q = q.eq('billing_type', filters.billingType);
      if (filters.vendor) q = q.ilike('vendor', `%${filters.vendor}%`);
      if (filters.from) q = q.gte('start_date', filters.from);
      if (filters.to) q = q.lte('start_date', filters.to);
      const { data, error } = await q.order('start_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ExpenseRow[];
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useExpenses`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useExpenses.ts \
        src/features/accounting_report/hooks/useExpenses.test.tsx
git commit -m "feat(accounting): useExpenses list hook with composable filters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `useExpensesRealtime` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useExpensesRealtime.ts`

Pattern matches `useAssignedTasksRealtime` exactly — invalidate every query key under `['expenses']`, `['expense']`, `['accounting-ledger']`, `['accounting-pl-summary']` on any INSERT/UPDATE/DELETE.

- [ ] **Step 1: Inspect the existing pattern**

Run: `cat src/features/assigned_tasks/hooks/useAssignedTasksRealtime.ts`

- [ ] **Step 2: Implement the hook**

```ts
// src/features/accounting_report/hooks/useExpensesRealtime.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useExpensesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`expenses-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          qc.invalidateQueries({ queryKey: ['expenses'] });
          qc.invalidateQueries({ queryKey: ['expense'] });
          qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
          qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting_report/hooks/useExpensesRealtime.ts
git commit -m "feat(accounting): useExpensesRealtime invalidates report caches

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `useLedger` hook (drilldown source)

**Files:**
- Create: `src/features/accounting_report/hooks/useLedger.ts`
- Create: `src/features/accounting_report/hooks/useLedger.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useLedger.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useLedger } from './useLedger';

const order = vi.fn();
const lte = vi.fn();
const gte = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.gte = gte.mockReturnValue(chain);
        chain.lte = lte.mockReturnValue(chain);
        chain.order = order.mockResolvedValue({
          data: [
            { direction: 'in',  event_date: '2026-06-10', amount_gross: 124, status: 'paid' },
            { direction: 'out', event_date: '2026-06-12', amount_gross: 50,  status: 'paid' },
          ],
          error: null,
        });
        return chain;
      }),
    })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useLedger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries accounting_ledger_v in the given range, ordered desc', async () => {
    const { result } = renderHook(
      () => useLedger({ from: '2026-06-01', to: '2026-06-30' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(gte).toHaveBeenCalledWith('event_date', '2026-06-01');
    expect(lte).toHaveBeenCalledWith('event_date', '2026-06-30');
    expect(order).toHaveBeenCalledWith('event_date', { ascending: false });
    expect(result.current.data).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useLedger`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useLedger.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type LedgerRow = {
  direction: 'in' | 'out';
  event_date: string;
  period: string;
  status: 'pending' | 'paid';
  amount_net: number;
  vat_amount: number;
  amount_gross: number;
  category_key: string | null;
  counterparty: string | null;
  billing_type: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  source_table: 'deal_payments' | 'expenses';
  source_id: string;
};

export function useLedger(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.accountingLedger(range.from, range.to),
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await supabase
        .from('accounting_ledger_v')
        .select('*')
        .gte('event_date', range.from)
        .lte('event_date', range.to)
        .order('event_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useLedger`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useLedger.ts \
        src/features/accounting_report/hooks/useLedger.test.tsx
git commit -m "feat(accounting): useLedger queries accounting_ledger_v in range

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `usePLSummary` hook (KPI source)

**Files:**
- Create: `src/features/accounting_report/hooks/usePLSummary.ts`
- Create: `src/features/accounting_report/hooks/usePLSummary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/usePLSummary.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { usePLSummary } from './usePLSummary';

const lte = vi.fn();
const gte = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.gte = gte.mockReturnValue(chain);
        chain.lte = lte.mockResolvedValue({
          data: [
            { period: '2026-06',
              total_income_net: 1000, total_income_vat: 240, total_income_gross: 1240,
              total_expense_net: 400, total_expense_vat: 96,  total_expense_gross: 496,
              net_profit_net: 600, net_profit_gross: 744 },
            { period: '2026-07',
              total_income_net: 500,  total_income_vat: 120, total_income_gross: 620,
              total_expense_net: 200, total_expense_vat: 48,  total_expense_gross: 248,
              net_profit_net: 300, net_profit_gross: 372 },
          ],
          error: null,
        });
        return chain;
      }),
    })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('usePLSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates rows in range into totals', async () => {
    const { result } = renderHook(
      () => usePLSummary({ from: '2026-06-01', to: '2026-07-31' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(gte).toHaveBeenCalledWith('period', '2026-06');
    expect(lte).toHaveBeenCalledWith('period', '2026-07');
    expect(result.current.data).toEqual({
      totalIncomeNet: 1500,
      totalIncomeVat: 360,
      totalIncomeGross: 1860,
      totalExpenseNet: 600,
      totalExpenseVat: 144,
      totalExpenseGross: 744,
      netProfitNet: 900,
      netProfitGross: 1116,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- usePLSummary`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/usePLSummary.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type PLSummary = {
  totalIncomeNet: number;
  totalIncomeVat: number;
  totalIncomeGross: number;
  totalExpenseNet: number;
  totalExpenseVat: number;
  totalExpenseGross: number;
  netProfitNet: number;
  netProfitGross: number;
};

function periodOf(dateISO: string) {
  return dateISO.slice(0, 7);
}

export function usePLSummary(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.accountingPLSummary(range.from, range.to),
    queryFn: async (): Promise<PLSummary> => {
      const { data, error } = await supabase
        .from('accounting_pl_summary_v')
        .select('*')
        .gte('period', periodOf(range.from))
        .lte('period', periodOf(range.to));
      if (error) throw error;
      const rows = data ?? [];
      const sum = (key: string) =>
        rows.reduce((acc: number, r: Record<string, number>) => acc + Number(r[key] ?? 0), 0);
      return {
        totalIncomeNet:    sum('total_income_net'),
        totalIncomeVat:    sum('total_income_vat'),
        totalIncomeGross:  sum('total_income_gross'),
        totalExpenseNet:   sum('total_expense_net'),
        totalExpenseVat:   sum('total_expense_vat'),
        totalExpenseGross: sum('total_expense_gross'),
        netProfitNet:      sum('net_profit_net'),
        netProfitGross:    sum('net_profit_gross'),
      };
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- usePLSummary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/usePLSummary.ts \
        src/features/accounting_report/hooks/usePLSummary.test.tsx
git commit -m "feat(accounting): usePLSummary aggregates P&L view rows in range

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `useCreateExpense` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useCreateExpense.ts`
- Create: `src/features/accounting_report/hooks/useCreateExpense.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useCreateExpense.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useCreateExpense } from './useCreateExpense';

const single = vi.fn();
const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ insert })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCreateExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1', amount_net: 100 }, error: null });
  });

  it('inserts an expense with the exact payload', async () => {
    const { result } = renderHook(() => useCreateExpense(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        categoryId: 'cat-1',
        vendor: 'Adobe',
        billingType: 'recurring_monthly',
        amountNet: 100,
        vatRate: 24,
        startDate: '2026-06-01',
        endDate: '2026-07-01',
        paymentMethod: 'card',
        notes: 'CC Suite',
      });
    });
    expect(insert).toHaveBeenCalledWith({
      category_id: 'cat-1',
      vendor: 'Adobe',
      billing_type: 'recurring_monthly',
      amount_net: 100,
      vat_rate: 24,
      start_date: '2026-06-01',
      end_date: '2026-07-01',
      payment_method: 'card',
      notes: 'CC Suite',
      paid_by: null,
      paid_at: null,
      status: 'pending',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('supports markPaid=true with paid_at + payment_method + paid_by', async () => {
    const { result } = renderHook(() => useCreateExpense(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        categoryId: 'cat-1',
        billingType: 'one_time',
        amountNet: 50,
        vatRate: 24,
        startDate: '2026-06-01',
        paymentMethod: 'cash',
        markPaid: true,
        paidByUserId: 'user-1',
      });
    });
    const payload = insert.mock.calls[0][0];
    expect(payload.status).toBe('paid');
    expect(payload.payment_method).toBe('cash');
    expect(payload.paid_by).toBe('user-1');
    expect(typeof payload.paid_at).toBe('string');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useCreateExpense`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useCreateExpense.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CreateExpenseInput = {
  categoryId: string;
  vendor?: string | null;
  billingType: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amountNet: number;
  vatRate: number;
  startDate: string;
  endDate?: string | null;
  paymentMethod?: string | null;
  paidByUserId?: string | null;
  notes?: string | null;
  markPaid?: boolean;
};

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      const isPaid = input.markPaid === true;
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          category_id: input.categoryId,
          vendor: input.vendor ?? null,
          billing_type: input.billingType,
          amount_net: input.amountNet,
          vat_rate: input.vatRate,
          start_date: input.startDate,
          end_date: input.endDate ?? null,
          payment_method: input.paymentMethod ?? null,
          notes: input.notes ?? null,
          paid_by: isPaid ? (input.paidByUserId ?? null) : null,
          paid_at: isPaid ? new Date().toISOString() : null,
          status: isPaid ? 'paid' : 'pending',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useCreateExpense`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useCreateExpense.ts \
        src/features/accounting_report/hooks/useCreateExpense.test.tsx
git commit -m "feat(accounting): useCreateExpense mutation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `useUpdateExpense` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useUpdateExpense.ts`
- Create: `src/features/accounting_report/hooks/useUpdateExpense.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useUpdateExpense.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useUpdateExpense } from './useUpdateExpense';

const single = vi.fn();
const select = vi.fn(() => ({ single }));
const eq = vi.fn(() => ({ select }));
const update = vi.fn(() => ({ eq }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ update })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useUpdateExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1' }, error: null });
  });

  it('updates only the fields supplied', async () => {
    const { result } = renderHook(() => useUpdateExpense(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'e1',
        patch: { vendor: 'Adobe (renewed)', notes: 'updated' },
      });
    });
    expect(update).toHaveBeenCalledWith({ vendor: 'Adobe (renewed)', notes: 'updated' });
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useUpdateExpense`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useUpdateExpense.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type UpdateExpensePatch = {
  vendor?: string | null;
  categoryId?: string;
  billingType?: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amountNet?: number;
  vatRate?: number;
  startDate?: string;
  endDate?: string | null;
  notes?: string | null;
  paymentMethod?: string | null;
  receiptPath?: string | null;
};

function toDbPatch(p: UpdateExpensePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.vendor !== undefined) out.vendor = p.vendor;
  if (p.categoryId !== undefined) out.category_id = p.categoryId;
  if (p.billingType !== undefined) out.billing_type = p.billingType;
  if (p.amountNet !== undefined) out.amount_net = p.amountNet;
  if (p.vatRate !== undefined) out.vat_rate = p.vatRate;
  if (p.startDate !== undefined) out.start_date = p.startDate;
  if (p.endDate !== undefined) out.end_date = p.endDate;
  if (p.notes !== undefined) out.notes = p.notes;
  if (p.paymentMethod !== undefined) out.payment_method = p.paymentMethod;
  if (p.receiptPath !== undefined) out.receipt_path = p.receiptPath;
  return out;
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateExpensePatch }) => {
      const { data, error } = await supabase
        .from('expenses')
        .update(toDbPatch(patch))
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense', vars.id] });
      qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useUpdateExpense`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useUpdateExpense.ts \
        src/features/accounting_report/hooks/useUpdateExpense.test.tsx
git commit -m "feat(accounting): useUpdateExpense partial-update mutation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `useMarkExpensePaid` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useMarkExpensePaid.ts`
- Create: `src/features/accounting_report/hooks/useMarkExpensePaid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useMarkExpensePaid.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useMarkExpensePaid } from './useMarkExpensePaid';

const single = vi.fn();
const select = vi.fn(() => ({ single }));
const eq = vi.fn(() => ({ select }));
const update = vi.fn(() => ({ eq }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn(() => ({ update })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useMarkExpensePaid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'e1' }, error: null });
  });

  it('sets status=paid, paid_at=now, payment_method, paid_by=currentUser', async () => {
    const { result } = renderHook(() => useMarkExpensePaid(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', paymentMethod: 'bank_transfer' });
    });
    const payload = update.mock.calls[0][0];
    expect(payload.status).toBe('paid');
    expect(payload.payment_method).toBe('bank_transfer');
    expect(payload.paid_by).toBe('user-1');
    expect(typeof payload.paid_at).toBe('string');
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useMarkExpensePaid`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useMarkExpensePaid.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useMarkExpensePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paymentMethod }: { id: string; paymentMethod: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      const { data, error } = await supabase
        .from('expenses')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          payment_method: paymentMethod,
          paid_by: userId,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense', vars.id] });
      qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useMarkExpensePaid`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useMarkExpensePaid.ts \
        src/features/accounting_report/hooks/useMarkExpensePaid.test.tsx
git commit -m "feat(accounting): useMarkExpensePaid sets paid_at + paid_by atomically

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `useDeleteExpense` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useDeleteExpense.ts`
- Create: `src/features/accounting_report/hooks/useDeleteExpense.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useDeleteExpense.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useDeleteExpense } from './useDeleteExpense';

const eq = vi.fn().mockResolvedValue({ error: null });
const del = vi.fn(() => ({ eq }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ delete: del })) },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDeleteExpense', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes by id', async () => {
    const { result } = renderHook(() => useDeleteExpense(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('e1');
    });
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useDeleteExpense`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useDeleteExpense.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
      qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useDeleteExpense`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useDeleteExpense.ts \
        src/features/accounting_report/hooks/useDeleteExpense.test.tsx
git commit -m "feat(accounting): useDeleteExpense mutation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: `useUploadReceipt` hook

**Files:**
- Create: `src/features/accounting_report/hooks/useUploadReceipt.ts`
- Create: `src/features/accounting_report/hooks/useUploadReceipt.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/hooks/useUploadReceipt.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useUploadReceipt, MAX_BYTES, ALLOWED_MIME } from './useUploadReceipt';

const upload = vi.fn().mockResolvedValue({ data: { path: 'p' }, error: null });
const fromBucket = vi.fn(() => ({ upload }));
const single = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null });
const select = vi.fn(() => ({ single }));
const eq = vi.fn(() => ({ select }));
const update = vi.fn(() => ({ eq }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: fromBucket },
    from: vi.fn(() => ({ update })),
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function makeFile(size: number, type = 'application/pdf', name = 'r.pdf') {
  return new File([new Uint8Array(size)], name, { type });
}

describe('useUploadReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads to expense-receipts/{id}/... and updates receipt_path', async () => {
    const { result } = renderHook(() => useUploadReceipt(), { wrapper });
    const file = makeFile(1024);
    await act(async () => {
      await result.current.mutateAsync({ expenseId: 'e1', file });
    });
    expect(fromBucket).toHaveBeenCalledWith('expense-receipts');
    const [path, body] = upload.mock.calls[0];
    expect(path).toMatch(/^e1\//);
    expect(body).toBe(file);
    expect(update).toHaveBeenCalledWith({ receipt_path: expect.stringMatching(/^e1\//) });
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });

  it('rejects oversized files before uploading', async () => {
    const { result } = renderHook(() => useUploadReceipt(), { wrapper });
    const file = makeFile(MAX_BYTES + 1);
    await expect(
      result.current.mutateAsync({ expenseId: 'e1', file }),
    ).rejects.toThrow(/larger than 10 MB/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects wrong MIME types before uploading', async () => {
    const { result } = renderHook(() => useUploadReceipt(), { wrapper });
    const file = makeFile(1024, 'text/plain', 'r.txt');
    await expect(
      result.current.mutateAsync({ expenseId: 'e1', file }),
    ).rejects.toThrow(/file type/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('exports the allowlist for the form to read', () => {
    expect(ALLOWED_MIME).toContain('application/pdf');
    expect(ALLOWED_MIME).toContain('image/png');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useUploadReceipt`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/accounting_report/hooks/useUploadReceipt.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export function useUploadReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ expenseId, file }: { expenseId: string; file: File }) => {
      if (file.size > MAX_BYTES) {
        throw new Error('File is larger than 10 MB.');
      }
      if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
        throw new Error('Unsupported file type.');
      }
      const path = `${expenseId}/${crypto.randomUUID()}-${sanitise(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from('expense-receipts')
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: updErr } = await supabase
        .from('expenses')
        .update({ receipt_path: path })
        .eq('id', expenseId)
        .select()
        .single();
      if (updErr) throw updErr;
      return path;
    },
    onSuccess: (_p, vars) => {
      qc.invalidateQueries({ queryKey: ['expense', vars.expenseId] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- useUploadReceipt`
Expected: PASS (4 of 4).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/hooks/useUploadReceipt.ts \
        src/features/accounting_report/hooks/useUploadReceipt.test.tsx
git commit -m "feat(accounting): useUploadReceipt validates + uploads + links

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: `formatRange` util

**Files:**
- Create: `src/features/accounting_report/utils/formatRange.ts`
- Create: `src/features/accounting_report/utils/formatRange.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/accounting_report/utils/formatRange.test.ts
import { describe, it, expect } from 'vitest';
import { rangeForPreset, formatIsoDate, periodOf } from './formatRange';

describe('formatRange', () => {
  it('this_month returns first/last day of the given anchor month', () => {
    const r = rangeForPreset('this_month', new Date('2026-06-15T12:00:00Z'));
    expect(r).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('last_month wraps the year correctly on Jan', () => {
    const r = rangeForPreset('last_month', new Date('2026-01-10T00:00:00Z'));
    expect(r).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('this_year covers Jan 1 → Dec 31 of the anchor year', () => {
    const r = rangeForPreset('this_year', new Date('2026-06-15T00:00:00Z'));
    expect(r).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('last_year covers prior calendar year', () => {
    const r = rangeForPreset('last_year', new Date('2026-06-15T00:00:00Z'));
    expect(r).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('formatIsoDate formats a Date to YYYY-MM-DD in UTC', () => {
    expect(formatIsoDate(new Date('2026-06-09T22:00:00Z'))).toBe('2026-06-09');
  });

  it('periodOf extracts YYYY-MM from YYYY-MM-DD', () => {
    expect(periodOf('2026-06-15')).toBe('2026-06');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- formatRange`
Expected: FAIL.

- [ ] **Step 3: Implement the util**

```ts
// src/features/accounting_report/utils/formatRange.ts
export type RangePreset =
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

export type DateRange = { from: string; to: string };

export function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

export function rangeForPreset(preset: RangePreset, anchor: Date = new Date()): DateRange {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  if (preset === 'this_month') {
    const from = new Date(Date.UTC(y, m, 1));
    const to = new Date(Date.UTC(y, m + 1, 0));
    return { from: formatIsoDate(from), to: formatIsoDate(to) };
  }
  if (preset === 'last_month') {
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0));
    return { from: formatIsoDate(from), to: formatIsoDate(to) };
  }
  if (preset === 'this_year') {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (preset === 'last_year') {
    return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
  return { from: formatIsoDate(anchor), to: formatIsoDate(anchor) };
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- formatRange`
Expected: PASS (6 of 6).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/utils/formatRange.ts \
        src/features/accounting_report/utils/formatRange.test.ts
git commit -m "feat(accounting): formatRange util for report time presets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: `exportCSV` util

**Files:**
- Create: `src/features/accounting_report/utils/exportCSV.ts`
- Create: `src/features/accounting_report/utils/exportCSV.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/accounting_report/utils/exportCSV.test.ts
import { describe, it, expect } from 'vitest';
import { ledgerRowsToCSV } from './exportCSV';
import type { LedgerRow } from '../hooks/useLedger';

const rows: LedgerRow[] = [
  {
    direction: 'in', event_date: '2026-06-10', period: '2026-06',
    status: 'paid', amount_net: 100, vat_amount: 24, amount_gross: 124,
    category_key: 'web_seo', counterparty: 'ACME Ltd, "Athens"',
    billing_type: 'recurring_monthly', source_table: 'deal_payments', source_id: 'x',
  },
  {
    direction: 'out', event_date: '2026-06-12', period: '2026-06',
    status: 'paid', amount_net: 40, vat_amount: 9.6, amount_gross: 49.6,
    category_key: 'software', counterparty: 'Adobe',
    billing_type: 'recurring_monthly', source_table: 'expenses', source_id: 'y',
  },
];

describe('ledgerRowsToCSV', () => {
  it('emits a header row and one data row per ledger entry', () => {
    const csv = ledgerRowsToCSV(rows);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^event_date,period,direction,status,category_key/);
  });

  it('escapes embedded commas and double-quotes', () => {
    const csv = ledgerRowsToCSV([rows[0]]);
    expect(csv).toContain('"ACME Ltd, ""Athens"""');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- exportCSV`
Expected: FAIL.

- [ ] **Step 3: Implement the util**

```ts
// src/features/accounting_report/utils/exportCSV.ts
import type { LedgerRow } from '../hooks/useLedger';

const COLUMNS = [
  'event_date',
  'period',
  'direction',
  'status',
  'category_key',
  'counterparty',
  'billing_type',
  'amount_net',
  'vat_amount',
  'amount_gross',
] as const;

function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function ledgerRowsToCSV(rows: LedgerRow[]): string {
  const head = COLUMNS.join(',');
  const body = rows
    .map((r) => COLUMNS.map((c) => escape((r as Record<string, unknown>)[c])).join(','))
    .join('\n');
  return `${head}\n${body}\n`;
}

export function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- exportCSV`
Expected: PASS (2 of 2).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/utils/exportCSV.ts \
        src/features/accounting_report/utils/exportCSV.test.ts
git commit -m "feat(accounting): ledgerRowsToCSV with proper escaping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: `exportPDF` util

**Files:**
- Create: `src/features/accounting_report/utils/exportPDF.ts`

> **Note:** Check `package.json` first — if `jspdf` is already a dependency, use it; otherwise run `npm i jspdf` and commit the lockfile in this same task.

- [ ] **Step 1: Install jsPDF if missing**

Run: `grep '"jspdf"' package.json || npm install jspdf`
Expected: either no install needed, or `package.json` + `package-lock.json` updated.

- [ ] **Step 2: Implement the util**

```ts
// src/features/accounting_report/utils/exportPDF.ts
import { jsPDF } from 'jspdf';
import type { PLSummary } from '../hooks/usePLSummary';
import type { LedgerRow } from '../hooks/useLedger';

export type PDFInput = {
  rangeLabel: string;
  summary: PLSummary;
  incomeRows: LedgerRow[];
  expenseRows: LedgerRow[];
};

function fmt(n: number) {
  return n.toFixed(2);
}

export function downloadPDF(filename: string, input: PDFInput): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 15;
  doc.setFontSize(16);
  doc.text('Accounting Report', 14, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(input.rangeLabel, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text(`Income (gross):  €${fmt(input.summary.totalIncomeGross)}`, 14, y); y += 6;
  doc.text(`Expense (gross): €${fmt(input.summary.totalExpenseGross)}`, 14, y); y += 6;
  doc.text(`Net profit:       €${fmt(input.summary.netProfitGross)}`, 14, y); y += 10;

  doc.setFontSize(11);
  doc.text('Income rows', 14, y); y += 6;
  for (const r of input.incomeRows.slice(0, 40)) {
    doc.text(
      `${r.event_date}  ${r.category_key ?? '-'}  ${r.counterparty ?? '-'}  €${fmt(r.amount_gross)}`,
      14, y,
    );
    y += 5;
    if (y > 280) { doc.addPage(); y = 15; }
  }

  y += 4;
  doc.text('Expense rows', 14, y); y += 6;
  for (const r of input.expenseRows.slice(0, 40)) {
    doc.text(
      `${r.event_date}  ${r.category_key ?? '-'}  ${r.counterparty ?? '-'}  €${fmt(r.amount_gross)}`,
      14, y,
    );
    y += 5;
    if (y > 280) { doc.addPage(); y = 15; }
  }

  doc.save(filename);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting_report/utils/exportPDF.ts package.json package-lock.json
git commit -m "feat(accounting): exportPDF — KPI tiles + income/expense rows via jsPDF

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: `ExportMenu` component

**Files:**
- Create: `src/features/accounting_report/components/ExportMenu.tsx`
- Create: `src/features/accounting_report/components/ExportMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/components/ExportMenu.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportMenu } from './ExportMenu';
import * as csv from '../utils/exportCSV';
import * as pdf from '../utils/exportPDF';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('ExportMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downloads CSV when CSV is clicked', () => {
    const spy = vi.spyOn(csv, 'downloadCSV').mockImplementation(() => undefined);
    render(
      <ExportMenu
        rangeLabel="2026-06"
        from="2026-06-01"
        to="2026-06-30"
        summary={{} as never}
        incomeRows={[]}
        expenseRows={[]}
      />,
    );
    fireEvent.click(screen.getByText('accounting_report:export.menu'));
    fireEvent.click(screen.getByText('accounting_report:export.csv'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/^accounting-2026-06-01-to-2026-06-30\.csv$/),
      expect.any(String),
    );
  });

  it('downloads PDF when PDF is clicked', () => {
    const spy = vi.spyOn(pdf, 'downloadPDF').mockImplementation(() => undefined);
    render(
      <ExportMenu
        rangeLabel="2026-06"
        from="2026-06-01"
        to="2026-06-30"
        summary={{} as never}
        incomeRows={[]}
        expenseRows={[]}
      />,
    );
    fireEvent.click(screen.getByText('accounting_report:export.menu'));
    fireEvent.click(screen.getByText('accounting_report:export.pdf'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/^accounting-2026-06-01-to-2026-06-30\.pdf$/),
      expect.objectContaining({ rangeLabel: '2026-06' }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ExportMenu`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/accounting_report/components/ExportMenu.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';
import type { PLSummary } from '../hooks/usePLSummary';
import { downloadCSV, ledgerRowsToCSV } from '../utils/exportCSV';
import { downloadPDF } from '../utils/exportPDF';

export type ExportMenuProps = {
  rangeLabel: string;
  from: string;
  to: string;
  summary: PLSummary;
  incomeRows: LedgerRow[];
  expenseRows: LedgerRow[];
};

export function ExportMenu({ rangeLabel, from, to, summary, incomeRows, expenseRows }: ExportMenuProps) {
  const { t } = useTranslation('accounting_report');
  const [open, setOpen] = useState(false);

  function csv() {
    const all = [...incomeRows, ...expenseRows];
    downloadCSV(`accounting-${from}-to-${to}.csv`, ledgerRowsToCSV(all));
    setOpen(false);
  }
  function pdf() {
    downloadPDF(`accounting-${from}-to-${to}.pdf`, { rangeLabel, summary, incomeRows, expenseRows });
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="rounded border px-3 py-1.5 text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        {t('export.menu')}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 rounded border bg-white shadow">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100"
            onClick={csv}
          >
            {t('export.csv')}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100"
            onClick={pdf}
          >
            {t('export.pdf')}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- ExportMenu`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/components/ExportMenu.tsx \
        src/features/accounting_report/components/ExportMenu.test.tsx
git commit -m "feat(accounting): ExportMenu wires CSV + PDF actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: `ExpenseRow` component

**Files:**
- Create: `src/features/accounting_report/components/ExpenseRow.tsx`

Pure presentational row used in `TransactionDrawer` and `ExpensesPage` list. No own tests — exercised via parent tests.

- [ ] **Step 1: Implement**

```tsx
// src/features/accounting_report/components/ExpenseRow.tsx
import { useTranslation } from 'react-i18next';
import type { ExpenseRow as ExpenseRowData } from '../hooks/useExpenses';

export type ExpenseRowProps = {
  row: ExpenseRowData;
  onClick: (id: string) => void;
};

export function ExpenseRow({ row, onClick }: ExpenseRowProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const isEl = i18n.language.startsWith('el');
  const categoryName = isEl ? row.category?.name_el : row.category?.name_en;
  return (
    <tr
      className="cursor-pointer hover:bg-neutral-50"
      onClick={() => onClick(row.id)}
      data-testid={`expense-row-${row.id}`}
    >
      <td className="px-3 py-2">{row.start_date}</td>
      <td className="px-3 py-2">{categoryName ?? row.category_id}</td>
      <td className="px-3 py-2">{row.vendor ?? '—'}</td>
      <td className="px-3 py-2 text-right">€{row.amount_net.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">€{row.vat_amount.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">€{row.amount_gross.toFixed(2)}</td>
      <td className="px-3 py-2">{t(`status.${row.status}`)}</td>
    </tr>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/components/ExpenseRow.tsx
git commit -m "feat(accounting): ExpenseRow presentational row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: `NewExpenseDialog` component

**Files:**
- Create: `src/features/accounting_report/components/NewExpenseDialog.tsx`
- Create: `src/features/accounting_report/components/NewExpenseDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/components/NewExpenseDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { NewExpenseDialog } from './NewExpenseDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const mockCategories = [
  { id: 'cat-rent', key: 'rent', name_en: 'Rent', name_el: 'Ενοίκιο', sort_order: 30 },
  { id: 'cat-software', key: 'software', name_en: 'Software', name_el: 'Λογισμικό', sort_order: 50 },
];
vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({ data: mockCategories, isSuccess: true }),
}));

const createMutate = vi.fn().mockResolvedValue({ id: 'e1' });
vi.mock('../hooks/useCreateExpense', () => ({
  useCreateExpense: () => ({ mutateAsync: createMutate, isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('NewExpenseDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks submit when category is missing', async () => {
    render(<NewExpenseDialog open onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByText('accounting_report:expense_form.submit'));
    await waitFor(() =>
      expect(screen.getByText('accounting_report:expense_form.validation.category_required'))
        .toBeInTheDocument(),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('computes gross from net + vat live', () => {
    render(<NewExpenseDialog open onClose={vi.fn()} />, { wrapper });
    fireEvent.change(
      screen.getByLabelText('accounting_report:expense_form.amount_net'),
      { target: { value: '100' } },
    );
    fireEvent.change(
      screen.getByLabelText('accounting_report:expense_form.vat_rate'),
      { target: { value: '13' } },
    );
    expect(screen.getByTestId('amount-gross-display').textContent).toContain('113.00');
  });

  it('submits a happy-path payload and closes', async () => {
    const onClose = vi.fn();
    render(<NewExpenseDialog open onClose={onClose} />, { wrapper });
    fireEvent.change(screen.getByLabelText('accounting_report:expense_form.category'), {
      target: { value: 'cat-rent' },
    });
    fireEvent.change(screen.getByLabelText('accounting_report:expense_form.vendor'), {
      target: { value: 'Building Ltd' },
    });
    fireEvent.change(screen.getByLabelText('accounting_report:expense_form.amount_net'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('accounting_report:expense_form.start_date'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.click(screen.getByText('accounting_report:expense_form.submit'));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    const arg = createMutate.mock.calls[0][0];
    expect(arg).toMatchObject({
      categoryId: 'cat-rent',
      vendor: 'Building Ltd',
      amountNet: 500,
      vatRate: 24,
      startDate: '2026-06-01',
      billingType: 'one_time',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- NewExpenseDialog`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/accounting_report/components/NewExpenseDialog.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseCategories } from '../hooks/useExpenseCategories';
import { useCreateExpense } from '../hooks/useCreateExpense';

export type NewExpenseDialogProps = {
  open: boolean;
  onClose: () => void;
};

type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';

function autoEndDate(start: string, billingType: BillingType): string | null {
  if (!start) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (billingType === 'one_time') return start;
  if (billingType === 'recurring_monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1);
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export function NewExpenseDialog({ open, onClose }: NewExpenseDialogProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const create = useCreateExpense();
  const isEl = i18n.language.startsWith('el');

  const [categoryId, setCategoryId] = useState('');
  const [vendor, setVendor] = useState('');
  const [billingType, setBillingType] = useState<BillingType>('one_time');
  const [amountNet, setAmountNet] = useState('');
  const [vatRate, setVatRate] = useState('24');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const grossNum =
    Number(amountNet || 0) + (Number(amountNet || 0) * Number(vatRate || 0)) / 100;

  function onBillingChange(bt: BillingType) {
    setBillingType(bt);
    if (startDate) {
      const auto = autoEndDate(startDate, bt);
      if (auto) setEndDate(auto);
    }
  }
  function onStartChange(s: string) {
    setStartDate(s);
    const auto = autoEndDate(s, billingType);
    if (auto) setEndDate(auto);
  }

  async function submit(markPaid: boolean) {
    setError(null);
    if (!categoryId) return setError(t('expense_form.validation.category_required'));
    if (!amountNet) return setError(t('expense_form.validation.amount_required'));
    if (!startDate) return setError(t('expense_form.validation.start_date_required'));
    if (endDate && endDate < startDate)
      return setError(t('expense_form.validation.end_date_after_start'));
    try {
      await create.mutateAsync({
        categoryId,
        vendor: vendor || null,
        billingType,
        amountNet: Number(amountNet),
        vatRate: Number(vatRate),
        startDate,
        endDate: endDate || null,
        paymentMethod: paymentMethod || null,
        notes: notes || null,
        markPaid,
      });
      onClose();
    } catch {
      setError(t('errors.save_failed'));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-white p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold">{t('expense_form.create_title')}</h2>

        <label className="block text-sm">
          {t('expense_form.category')}
          <select
            aria-label={t('expense_form.category')}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          >
            <option value="">{t('expense_form.category_placeholder')}</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{isEl ? c.name_el : c.name_en}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm">
          {t('expense_form.vendor')}
          <input
            aria-label={t('expense_form.vendor')}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>

        <div className="mt-3 flex gap-2 text-sm">
          {(['one_time','recurring_monthly','recurring_yearly'] as BillingType[]).map((bt) => (
            <button
              key={bt}
              type="button"
              onClick={() => onBillingChange(bt)}
              className={`rounded border px-2 py-1 ${billingType === bt ? 'bg-neutral-900 text-white' : ''}`}
            >
              {t(`expense_form.${bt}`)}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <label>
            {t('expense_form.amount_net')}
            <input
              aria-label={t('expense_form.amount_net')}
              type="number" step="0.01" min="0"
              value={amountNet}
              onChange={(e) => setAmountNet(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
            />
          </label>
          <label>
            {t('expense_form.vat_rate')}
            <input
              aria-label={t('expense_form.vat_rate')}
              type="number" step="0.01" min="0" max="100"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
            />
          </label>
          <div>
            {t('expense_form.amount_gross')}
            <div data-testid="amount-gross-display" className="mt-1 rounded border bg-neutral-50 px-2 py-1">
              €{grossNum.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <label>
            {t('expense_form.start_date')}
            <input
              aria-label={t('expense_form.start_date')}
              type="date"
              value={startDate}
              onChange={(e) => onStartChange(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
            />
          </label>
          <label>
            {t('expense_form.end_date')}
            <input
              aria-label={t('expense_form.end_date')}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
            />
          </label>
        </div>

        <label className="mt-3 block text-sm">
          {t('expense_form.payment_method')}
          <input
            aria-label={t('expense_form.payment_method')}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>

        <label className="mt-3 block text-sm">
          {t('expense_form.notes')}
          <textarea
            aria-label={t('expense_form.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
            rows={2}
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            {t('expense_form.cancel')}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={() => submit(true)}
            disabled={create.isPending}
          >
            {t('expense_form.submit_and_mark_paid')}
          </button>
          <button
            type="button"
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
            onClick={() => submit(false)}
            disabled={create.isPending}
          >
            {t('expense_form.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- NewExpenseDialog`
Expected: PASS (3 of 3).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/components/NewExpenseDialog.tsx \
        src/features/accounting_report/components/NewExpenseDialog.test.tsx
git commit -m "feat(accounting): NewExpenseDialog with validation + live gross

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: `ExpenseDetailDialog` component

**Files:**
- Create: `src/features/accounting_report/hooks/useExpenseDetail.ts` (small read hook used by the dialog)
- Create: `src/features/accounting_report/components/ExpenseDetailDialog.tsx`
- Create: `src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`

- [ ] **Step 1: Implement the detail hook**

```ts
// src/features/accounting_report/hooks/useExpenseDetail.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ExpenseRow } from './useExpenses';

const SELECT = `
  id, category_id, vendor, billing_type,
  amount_net, vat_rate, vat_amount, amount_gross,
  start_date, end_date, status, payment_method, paid_at, paid_by,
  notes, receipt_path, parent_expense_id, created_by, created_at,
  category:expense_categories ( key, name_en, name_el )
`;

export function useExpenseDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.expense(id) : ['expense', 'null'],
    enabled: !!id,
    queryFn: async (): Promise<ExpenseRow | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('expenses')
        .select(SELECT)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as ExpenseRow;
    },
  });
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// src/features/accounting_report/components/ExpenseDetailDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ExpenseDetailDialog } from './ExpenseDetailDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const sample = {
  id: 'e1',
  category_id: 'cat-rent',
  vendor: 'Building Ltd',
  billing_type: 'one_time',
  amount_net: 500, vat_rate: 24, vat_amount: 120, amount_gross: 620,
  start_date: '2026-06-01', end_date: null,
  status: 'pending',
  payment_method: null, paid_at: null, paid_by: null,
  notes: 'June rent', receipt_path: null,
  parent_expense_id: null, created_by: null, created_at: '2026-06-01',
  category: { key: 'rent', name_en: 'Rent', name_el: 'Ενοίκιο' },
};
vi.mock('../hooks/useExpenseDetail', () => ({
  useExpenseDetail: () => ({ data: sample, isSuccess: true, isLoading: false }),
}));

const markPaidMutate = vi.fn().mockResolvedValue({ id: 'e1' });
vi.mock('../hooks/useMarkExpensePaid', () => ({
  useMarkExpensePaid: () => ({ mutateAsync: markPaidMutate, isPending: false }),
}));

const deleteMutate = vi.fn().mockResolvedValue('e1');
vi.mock('../hooks/useDeleteExpense', () => ({
  useDeleteExpense: () => ({ mutateAsync: deleteMutate, isPending: false }),
}));

const uploadMutate = vi.fn().mockResolvedValue('e1/path.pdf');
vi.mock('../hooks/useUploadReceipt', () => ({
  useUploadReceipt: () => ({ mutateAsync: uploadMutate, isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ExpenseDetailDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders core fields', () => {
    render(<ExpenseDetailDialog open id="e1" onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText(/Building Ltd/)).toBeInTheDocument();
    expect(screen.getByText(/620\.00/)).toBeInTheDocument();
  });

  it('marks paid via the action button', async () => {
    render(<ExpenseDetailDialog open id="e1" onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByText('accounting_report:expense_detail.mark_paid'));
    fireEvent.change(screen.getByLabelText('accounting_report:expense_form.payment_method'), {
      target: { value: 'bank_transfer' },
    });
    fireEvent.click(screen.getByText('accounting_report:expense_form.submit'));
    await waitFor(() =>
      expect(markPaidMutate).toHaveBeenCalledWith({ id: 'e1', paymentMethod: 'bank_transfer' }),
    );
  });

  it('uploads a receipt', async () => {
    render(<ExpenseDetailDialog open id="e1" onClose={vi.fn()} />, { wrapper });
    const file = new File([new Uint8Array(10)], 'r.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText('accounting_report:expense_form.upload_receipt') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledWith({ expenseId: 'e1', file }));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- ExpenseDetailDialog`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

```tsx
// src/features/accounting_report/components/ExpenseDetailDialog.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseDetail } from '../hooks/useExpenseDetail';
import { useMarkExpensePaid } from '../hooks/useMarkExpensePaid';
import { useDeleteExpense } from '../hooks/useDeleteExpense';
import { useUploadReceipt } from '../hooks/useUploadReceipt';

export type ExpenseDetailDialogProps = {
  open: boolean;
  id: string | null;
  onClose: () => void;
};

export function ExpenseDetailDialog({ open, id, onClose }: ExpenseDetailDialogProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const detail = useExpenseDetail(open ? id : null);
  const markPaid = useMarkExpensePaid();
  const del = useDeleteExpense();
  const upload = useUploadReceipt();

  const [showPaidForm, setShowPaidForm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');

  if (!open || !id) return null;
  const e = detail.data;
  const isEl = i18n.language.startsWith('el');

  async function onUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file || !id) return;
    await upload.mutateAsync({ expenseId: id, file });
  }

  async function onMarkPaid() {
    if (!id || !paymentMethod) return;
    await markPaid.mutateAsync({ id, paymentMethod });
    setShowPaidForm(false);
    setPaymentMethod('');
  }

  async function onDelete() {
    if (!id) return;
    if (!confirm(t('expense_detail.delete_confirm'))) return;
    await del.mutateAsync(id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-white p-6 shadow">
        <h2 className="mb-2 text-lg font-semibold">{t('expense_detail.title')}</h2>
        {detail.isLoading || !e ? (
          <p>…</p>
        ) : (
          <>
            <p className="text-sm text-neutral-600">
              {(isEl ? e.category?.name_el : e.category?.name_en) ?? e.category_id} · {e.vendor ?? '—'}
            </p>
            <p className="mt-3 text-sm">
              {t('expense_form.amount_net')}: €{e.amount_net.toFixed(2)} ·{' '}
              {t('expense_form.vat_rate')}: {e.vat_rate}% · {t('expense_form.amount_gross')}: €{e.amount_gross.toFixed(2)}
            </p>
            <p className="mt-1 text-sm">
              {t('expense_form.start_date')}: {e.start_date}
              {e.end_date && ` → ${e.end_date}`}
            </p>
            <p className="mt-1 text-sm">
              {t('transaction_drawer.status')}: {t(`status.${e.status}`)}
              {e.status === 'paid' && e.paid_at && ` (${e.paid_at})`}
            </p>
            {e.notes && <p className="mt-2 text-sm">{e.notes}</p>}

            <div className="mt-4 flex items-center gap-3">
              <label className="text-sm">
                {t('expense_form.upload_receipt')}
                <input
                  type="file"
                  aria-label={t('expense_form.upload_receipt')}
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={onUpload}
                  className="mt-1 block text-xs"
                />
              </label>
            </div>

            {e.status !== 'paid' && (
              <div className="mt-4">
                {!showPaidForm ? (
                  <button
                    type="button"
                    onClick={() => setShowPaidForm(true)}
                    className="rounded border px-3 py-1.5 text-sm"
                  >
                    {t('expense_detail.mark_paid')}
                  </button>
                ) : (
                  <div className="flex items-end gap-2">
                    <label className="text-sm">
                      {t('expense_form.payment_method')}
                      <input
                        aria-label={t('expense_form.payment_method')}
                        value={paymentMethod}
                        onChange={(ev) => setPaymentMethod(ev.target.value)}
                        className="mt-1 block rounded border px-2 py-1"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={onMarkPaid}
                      className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
                    >
                      {t('expense_form.submit')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button type="button" onClick={onDelete} className="rounded border px-3 py-1.5 text-sm text-red-600">
                {t('expense_detail.delete')}
              </button>
              <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">
                {t('expense_form.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Re-run the test**

Run: `npm test -- ExpenseDetailDialog`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/accounting_report/hooks/useExpenseDetail.ts \
        src/features/accounting_report/components/ExpenseDetailDialog.tsx \
        src/features/accounting_report/components/ExpenseDetailDialog.test.tsx
git commit -m "feat(accounting): ExpenseDetailDialog with mark-paid + upload + delete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: `TransactionDrawer` component

**Files:**
- Create: `src/features/accounting_report/components/TransactionDrawer.tsx`

Presentational, exercised through `ReportPage` test in Task 32.

- [ ] **Step 1: Implement**

```tsx
// src/features/accounting_report/components/TransactionDrawer.tsx
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';

export type TransactionDrawerProps = {
  open: boolean;
  title: string;
  rows: LedgerRow[];
  onClose: () => void;
  onSelectExpense?: (id: string) => void;
};

export function TransactionDrawer({
  open, title, rows, onClose, onSelectExpense,
}: TransactionDrawerProps) {
  const { t } = useTranslation('accounting_report');
  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-auto bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" className="text-sm" onClick={onClose}>
          {t('transaction_drawer.close')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-neutral-600">{t('transaction_drawer.empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="px-3 py-2">{t('transaction_drawer.date')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.counterparty')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.billing_type')}</th>
              <th className="px-3 py-2 text-right">{t('transaction_drawer.net')}</th>
              <th className="px-3 py-2 text-right">{t('transaction_drawer.vat')}</th>
              <th className="px-3 py-2 text-right">{t('transaction_drawer.gross')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.source_table}-${r.source_id}`}
                className={r.source_table === 'expenses' ? 'cursor-pointer hover:bg-neutral-50' : ''}
                onClick={() => {
                  if (r.source_table === 'expenses' && onSelectExpense) onSelectExpense(r.source_id);
                }}
              >
                <td className="px-3 py-2">{r.event_date}</td>
                <td className="px-3 py-2">{r.counterparty ?? '—'}</td>
                <td className="px-3 py-2">{r.billing_type}</td>
                <td className="px-3 py-2 text-right">€{r.amount_net.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">€{r.vat_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">€{r.amount_gross.toFixed(2)}</td>
                <td className="px-3 py-2">{t(`status.${r.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/components/TransactionDrawer.tsx
git commit -m "feat(accounting): TransactionDrawer for drilldown slices

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: `IncomeBreakdown` component

**Files:**
- Create: `src/features/accounting_report/components/IncomeBreakdown.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/features/accounting_report/components/IncomeBreakdown.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';

export type IncomeBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[]) => void;
};

type Group = {
  key: string | null;
  count: number;
  net: number;
  vat: number;
  gross: number;
  rows: LedgerRow[];
};

export function IncomeBreakdown({ rows, onSelectGroup }: IncomeBreakdownProps) {
  const { t } = useTranslation('accounting_report');
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      if (r.direction !== 'in' || r.status !== 'paid') continue;
      const k = r.category_key ?? '__unspecified';
      const g = map.get(k) ?? { key: r.category_key, count: 0, net: 0, vat: 0, gross: 0, rows: [] };
      g.count += 1;
      g.net += r.amount_net;
      g.vat += r.vat_amount;
      g.gross += r.amount_gross;
      g.rows.push(r);
      map.set(k, g);
    }
    return Array.from(map.values()).sort((a, b) => b.gross - a.gross);
  }, [rows]);

  const totalGross = groups.reduce((s, g) => s + g.gross, 0);

  return (
    <section>
      <h3 className="mb-2 font-semibold">{t('income_breakdown.title')}</h3>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left">
          <tr>
            <th className="px-3 py-2">{t('income_breakdown.service')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.count')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.net')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.vat')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.gross')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.percent')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.key ?? 'unspecified'}
              className="cursor-pointer hover:bg-neutral-50"
              onClick={() => onSelectGroup(g.key, g.rows)}
            >
              <td className="px-3 py-2">{g.key ?? t('income_breakdown.unknown')}</td>
              <td className="px-3 py-2 text-right">{g.count}</td>
              <td className="px-3 py-2 text-right">€{g.net.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">€{g.vat.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">€{g.gross.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                {totalGross > 0 ? ((g.gross / totalGross) * 100).toFixed(1) : '0.0'}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/components/IncomeBreakdown.tsx
git commit -m "feat(accounting): IncomeBreakdown grouped by service_type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 30: `ExpenseBreakdown` component

**Files:**
- Create: `src/features/accounting_report/components/ExpenseBreakdown.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/features/accounting_report/components/ExpenseBreakdown.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';
import { useExpenseCategories } from '../hooks/useExpenseCategories';

export type ExpenseBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[]) => void;
  onNewExpense: () => void;
};

type Group = {
  key: string | null;
  count: number;
  net: number;
  vat: number;
  gross: number;
  rows: LedgerRow[];
};

export function ExpenseBreakdown({ rows, onSelectGroup, onNewExpense }: ExpenseBreakdownProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const isEl = i18n.language.startsWith('el');

  const labelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cats.data ?? []) {
      map.set(c.key, isEl ? c.name_el : c.name_en);
    }
    return map;
  }, [cats.data, isEl]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      if (r.direction !== 'out' || r.status !== 'paid') continue;
      const k = r.category_key ?? '__unspecified';
      const g = map.get(k) ?? { key: r.category_key, count: 0, net: 0, vat: 0, gross: 0, rows: [] };
      g.count += 1;
      g.net += r.amount_net;
      g.vat += r.vat_amount;
      g.gross += r.amount_gross;
      g.rows.push(r);
      map.set(k, g);
    }
    return Array.from(map.values()).sort((a, b) => b.gross - a.gross);
  }, [rows]);

  const totalGross = groups.reduce((s, g) => s + g.gross, 0);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{t('expense_breakdown.title')}</h3>
        <button
          type="button"
          onClick={onNewExpense}
          className="rounded border px-3 py-1.5 text-sm"
        >
          {t('expense_breakdown.new_expense')}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left">
          <tr>
            <th className="px-3 py-2">{t('expense_breakdown.category')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.count')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.net')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.vat')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.gross')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.percent')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.key ?? 'unspecified'}
              className="cursor-pointer hover:bg-neutral-50"
              onClick={() => onSelectGroup(g.key, g.rows)}
            >
              <td className="px-3 py-2">{g.key ? (labelByKey.get(g.key) ?? g.key) : '—'}</td>
              <td className="px-3 py-2 text-right">{g.count}</td>
              <td className="px-3 py-2 text-right">€{g.net.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">€{g.vat.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">€{g.gross.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                {totalGross > 0 ? ((g.gross / totalGross) * 100).toFixed(1) : '0.0'}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/components/ExpenseBreakdown.tsx
git commit -m "feat(accounting): ExpenseBreakdown grouped by category

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 31: `ReportHeader` component (range picker + KPI tiles)

**Files:**
- Create: `src/features/accounting_report/components/ReportHeader.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/features/accounting_report/components/ReportHeader.tsx
import { useTranslation } from 'react-i18next';
import type { RangePreset, DateRange } from '../utils/formatRange';
import type { PLSummary } from '../hooks/usePLSummary';

export type ReportHeaderProps = {
  preset: RangePreset;
  range: DateRange;
  onPreset: (preset: RangePreset) => void;
  onCustomFrom: (iso: string) => void;
  onCustomTo: (iso: string) => void;
  summary: PLSummary | undefined;
  mrr: number;
  ytdSummary: PLSummary | undefined;
};

function Tile({
  label, gross, net, suffix,
}: { label: string; gross: number; net?: number; suffix: string }) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">€{gross.toFixed(2)}</p>
      {net !== undefined && (
        <p className="text-xs text-neutral-500">€{net.toFixed(2)} {suffix}</p>
      )}
    </div>
  );
}

export function ReportHeader({
  preset, range, onPreset, onCustomFrom, onCustomTo,
  summary, mrr, ytdSummary,
}: ReportHeaderProps) {
  const { t } = useTranslation('accounting_report');
  const presets: RangePreset[] = ['this_month', 'last_month', 'this_year', 'last_year', 'custom'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            className={`rounded border px-3 py-1.5 text-sm ${preset === p ? 'bg-neutral-900 text-white' : ''}`}
          >
            {t(`range.${p}`)}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="ml-4 flex gap-2 text-sm">
            <label>
              {t('range.from')}
              <input
                type="date"
                value={range.from}
                onChange={(e) => onCustomFrom(e.target.value)}
                className="ml-1 rounded border px-2 py-1"
              />
            </label>
            <label>
              {t('range.to')}
              <input
                type="date"
                value={range.to}
                onChange={(e) => onCustomTo(e.target.value)}
                className="ml-1 rounded border px-2 py-1"
              />
            </label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('kpi.income')}
          gross={summary?.totalIncomeGross ?? 0}
          net={summary?.totalIncomeNet}
          suffix={t('kpi.net_suffix')}
        />
        <Tile
          label={t('kpi.expense')}
          gross={summary?.totalExpenseGross ?? 0}
          net={summary?.totalExpenseNet}
          suffix={t('kpi.net_suffix')}
        />
        <Tile
          label={t('kpi.net_profit')}
          gross={summary?.netProfitGross ?? 0}
          net={summary?.netProfitNet}
          suffix={t('kpi.net_suffix')}
        />
        <Tile label={t('kpi.mrr')} gross={mrr} suffix="" />
      </div>

      {ytdSummary && (
        <div className="rounded border bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          {t('kpi.ytd')}: {t('kpi.income')} €{ytdSummary.totalIncomeGross.toFixed(2)} ·{' '}
          {t('kpi.expense')} €{ytdSummary.totalExpenseGross.toFixed(2)} ·{' '}
          {t('kpi.net_profit')} €{ytdSummary.netProfitGross.toFixed(2)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/components/ReportHeader.tsx
git commit -m "feat(accounting): ReportHeader range picker + KPI tiles + YTD footer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 32: `useMRR` helper hook

**Files:**
- Create: `src/features/accounting_report/hooks/useMRR.ts`

A small helper that returns the sum of `amount_gross` for paid `deal_payments` where `billing_type='recurring_monthly'` AND the row's `start_date`/`end_date` overlap the given range. Keeps `ReportPage` thin.

- [ ] **Step 1: Implement**

```ts
// src/features/accounting_report/hooks/useMRR.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useMRR(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['accounting-mrr', range.from, range.to],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('deal_payments')
        .select('amount_gross, start_date, end_date, status, billing_type')
        .eq('billing_type', 'recurring_monthly')
        .eq('status', 'paid')
        .lte('start_date', range.to)
        .gte('end_date', range.from);
      if (error) throw error;
      return (data ?? []).reduce(
        (s: number, r: { amount_gross: number | null }) => s + Number(r.amount_gross ?? 0),
        0,
      );
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/hooks/useMRR.ts
git commit -m "feat(accounting): useMRR sums recurring_monthly paid income in range

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 33: `ReportPage`

**Files:**
- Create: `src/features/accounting_report/ReportPage.tsx`
- Create: `src/features/accounting_report/ReportPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/accounting_report/ReportPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ReportPage } from './ReportPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('./hooks/useExpensesRealtime', () => ({ useExpensesRealtime: () => undefined }));
vi.mock('./hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({ data: [], isSuccess: true }),
}));
vi.mock('./hooks/useMRR', () => ({ useMRR: () => ({ data: 0 }) }));
vi.mock('./hooks/usePLSummary', () => ({
  usePLSummary: () => ({
    data: {
      totalIncomeNet: 1000, totalIncomeVat: 240, totalIncomeGross: 1240,
      totalExpenseNet: 400, totalExpenseVat: 96, totalExpenseGross: 496,
      netProfitNet: 600, netProfitGross: 744,
    },
    isSuccess: true,
  }),
}));
vi.mock('./hooks/useLedger', () => ({
  useLedger: () => ({
    data: [
      { direction: 'in',  event_date: '2026-06-10', period: '2026-06', status: 'paid',
        amount_net: 100, vat_amount: 24, amount_gross: 124,
        category_key: 'web_seo', counterparty: 'Acme', billing_type: 'recurring_monthly',
        source_table: 'deal_payments', source_id: 'in-1' },
      { direction: 'out', event_date: '2026-06-12', period: '2026-06', status: 'paid',
        amount_net: 50, vat_amount: 12, amount_gross: 62,
        category_key: 'software', counterparty: 'Adobe', billing_type: 'recurring_monthly',
        source_table: 'expenses', source_id: 'out-1' },
    ],
    isSuccess: true,
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ReportPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders KPI tiles with the summary numbers', () => {
    render(<ReportPage />, { wrapper });
    expect(screen.getByText('€1240.00')).toBeInTheDocument();
    expect(screen.getByText('€496.00')).toBeInTheDocument();
    expect(screen.getByText('€744.00')).toBeInTheDocument();
  });

  it('opens the drawer when an income row is clicked', () => {
    render(<ReportPage />, { wrapper });
    fireEvent.click(screen.getByText('web_seo'));
    const drawer = screen.getByRole('heading', { name: /accounting_report:transaction_drawer.title|web_seo/i });
    expect(drawer).toBeInTheDocument();
  });

  it('shows the New expense button on the expense breakdown', () => {
    render(<ReportPage />, { wrapper });
    expect(screen.getByText('accounting_report:expense_breakdown.new_expense')).toBeInTheDocument();
  });

  it('opens the NewExpenseDialog on click', () => {
    render(<ReportPage />, { wrapper });
    fireEvent.click(screen.getByText('accounting_report:expense_breakdown.new_expense'));
    expect(screen.getByText('accounting_report:expense_form.create_title')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ReportPage`
Expected: FAIL.

- [ ] **Step 3: Implement the page**

```tsx
// src/features/accounting_report/ReportPage.tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rangeForPreset, type RangePreset, type DateRange } from './utils/formatRange';
import { useLedger, type LedgerRow } from './hooks/useLedger';
import { usePLSummary } from './hooks/usePLSummary';
import { useMRR } from './hooks/useMRR';
import { useExpensesRealtime } from './hooks/useExpensesRealtime';
import { ReportHeader } from './components/ReportHeader';
import { IncomeBreakdown } from './components/IncomeBreakdown';
import { ExpenseBreakdown } from './components/ExpenseBreakdown';
import { TransactionDrawer } from './components/TransactionDrawer';
import { ExportMenu } from './components/ExportMenu';
import { NewExpenseDialog } from './components/NewExpenseDialog';
import { ExpenseDetailDialog } from './components/ExpenseDetailDialog';

export function ReportPage() {
  const { t } = useTranslation('accounting_report');
  useExpensesRealtime();

  const [preset, setPreset] = useState<RangePreset>('this_month');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('this_month'));

  function onPreset(p: RangePreset) {
    setPreset(p);
    if (p !== 'custom') setRange(rangeForPreset(p));
  }

  const summary = usePLSummary(range);
  const ytdRange = useMemo(() => rangeForPreset('this_year'), []);
  const ytdSummary = usePLSummary(ytdRange);
  const mrr = useMRR(range);
  const ledger = useLedger(range);

  const incomeRows = useMemo(
    () => (ledger.data ?? []).filter((r) => r.direction === 'in' && r.status === 'paid'),
    [ledger.data],
  );
  const expenseRows = useMemo(
    () => (ledger.data ?? []).filter((r) => r.direction === 'out' && r.status === 'paid'),
    [ledger.data],
  );

  const [drawer, setDrawer] = useState<{ title: string; rows: LedgerRow[] } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function openIncomeGroup(key: string | null, rows: LedgerRow[]) {
    setDrawer({ title: key ?? t('income_breakdown.unknown'), rows });
  }
  function openExpenseGroup(key: string | null, rows: LedgerRow[]) {
    setDrawer({ title: key ?? t('expense_breakdown.category'), rows });
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('page_title')}</h1>
          <p className="text-sm text-neutral-600">{t('page_subtitle')}</p>
        </div>
        {summary.data && (
          <ExportMenu
            rangeLabel={`${range.from} → ${range.to}`}
            from={range.from}
            to={range.to}
            summary={summary.data}
            incomeRows={incomeRows}
            expenseRows={expenseRows}
          />
        )}
      </header>

      <ReportHeader
        preset={preset}
        range={range}
        onPreset={onPreset}
        onCustomFrom={(iso) => setRange((r) => ({ ...r, from: iso }))}
        onCustomTo={(iso) => setRange((r) => ({ ...r, to: iso }))}
        summary={summary.data}
        mrr={mrr.data ?? 0}
        ytdSummary={ytdSummary.data}
      />

      <IncomeBreakdown rows={incomeRows} onSelectGroup={openIncomeGroup} />
      <ExpenseBreakdown
        rows={expenseRows}
        onSelectGroup={openExpenseGroup}
        onNewExpense={() => setShowNew(true)}
      />

      <TransactionDrawer
        open={!!drawer}
        title={drawer?.title ?? ''}
        rows={drawer?.rows ?? []}
        onClose={() => setDrawer(null)}
        onSelectExpense={(id) => {
          setDetailId(id);
          setDrawer(null);
        }}
      />

      <NewExpenseDialog open={showNew} onClose={() => setShowNew(false)} />
      <ExpenseDetailDialog open={!!detailId} id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm test -- ReportPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/ReportPage.tsx \
        src/features/accounting_report/ReportPage.test.tsx
git commit -m "feat(accounting): ReportPage assembles header + breakdowns + drawer + dialogs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 34: `ExpensesPage`

**Files:**
- Create: `src/features/accounting_report/ExpensesPage.tsx`

Flat list with filters; clicking opens the same `ExpenseDetailDialog`. No standalone test — pieces exercised elsewhere; verify manually in Task 38.

- [ ] **Step 1: Implement**

```tsx
// src/features/accounting_report/ExpensesPage.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenses } from './hooks/useExpenses';
import { useExpenseCategories } from './hooks/useExpenseCategories';
import { useExpensesRealtime } from './hooks/useExpensesRealtime';
import { ExpenseDetailDialog } from './components/ExpenseDetailDialog';
import { NewExpenseDialog } from './components/NewExpenseDialog';

export function ExpensesPage() {
  const { t, i18n } = useTranslation('accounting_report');
  useExpensesRealtime();

  const [status, setStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  const [vendor, setVendor] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const cats = useExpenseCategories();
  const isEl = i18n.language.startsWith('el');

  const expenses = useExpenses({
    status: status === 'all' ? undefined : status,
    categoryId: categoryId || undefined,
    vendor: vendor || undefined,
  });

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('expenses_page_title')}</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          {t('expense_breakdown.new_expense')}
        </button>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        {(['all', 'pending', 'paid'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded border px-3 py-1.5 ${status === s ? 'bg-neutral-900 text-white' : ''}`}
          >
            {t(`expenses_list.status_${s}`)}
          </button>
        ))}
        <select
          aria-label={t('expense_form.category')}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded border px-2 py-1"
        >
          <option value="">{t('expenses_list.category_all')}</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{isEl ? c.name_el : c.name_en}</option>
          ))}
        </select>
        <input
          aria-label={t('expenses_list.search_placeholder')}
          placeholder={t('expenses_list.search_placeholder')}
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </div>

      {expenses.data && expenses.data.length === 0 && (
        <p className="text-sm text-neutral-600">{t('expenses_list.empty')}</p>
      )}

      {expenses.data && expenses.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="px-3 py-2">{t('expense_form.start_date')}</th>
              <th className="px-3 py-2">{t('expense_form.category')}</th>
              <th className="px-3 py-2">{t('expense_form.vendor')}</th>
              <th className="px-3 py-2 text-right">{t('expense_breakdown.net')}</th>
              <th className="px-3 py-2 text-right">{t('expense_breakdown.vat')}</th>
              <th className="px-3 py-2 text-right">{t('expense_breakdown.gross')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.status')}</th>
            </tr>
          </thead>
          <tbody>
            {expenses.data.map((r) => {
              const categoryName = isEl ? r.category?.name_el : r.category?.name_en;
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-neutral-50"
                  onClick={() => setDetailId(r.id)}
                >
                  <td className="px-3 py-2">{r.start_date}</td>
                  <td className="px-3 py-2">{categoryName ?? r.category_id}</td>
                  <td className="px-3 py-2">{r.vendor ?? '—'}</td>
                  <td className="px-3 py-2 text-right">€{r.amount_net.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">€{r.vat_amount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">€{r.amount_gross.toFixed(2)}</td>
                  <td className="px-3 py-2">{t(`status.${r.status}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <NewExpenseDialog open={showNew} onClose={() => setShowNew(false)} />
      <ExpenseDetailDialog open={!!detailId} id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/features/accounting_report/ExpensesPage.tsx
git commit -m "feat(accounting): ExpensesPage flat list with filters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 35: Routes + sidebar wiring

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Inspect the existing admin guard + sidebar pattern**

Run: `grep -n "AdminGuard\|RequireGroup" src/app/router.tsx | head` and `grep -n "accounting" src/components/layout/Sidebar.tsx`.

The repo already has `AdminGuard` (`src/components/auth/AdminGuard.tsx`). Use it. If the existing `/accounting` block is wrapped in `RequireGroup`, leave that for the existing pages and add a sibling block wrapped in `AdminGuard` for the two new routes. If easier, wrap each route element individually.

- [ ] **Step 2: Register lazy imports in `src/app/router.tsx`**

Add to the lazyPage declarations near the other accounting entries:

```ts
const AccountingReportPage = lazyPage(
  () => import('@/features/accounting_report/ReportPage'),
  'ReportPage',
);
const AccountingExpensesPage = lazyPage(
  () => import('@/features/accounting_report/ExpensesPage'),
  'ExpensesPage',
);
```

- [ ] **Step 3: Add the two new child routes**

Inside the `accounting` route's `children` array (next to `'onboarding'`, `'clients'`, `'recurring'`), add:

```ts
{ path: 'report',   element: <AdminGuard><AccountingReportPage /></AdminGuard> },
{ path: 'expenses', element: <AdminGuard><AccountingExpensesPage /></AdminGuard> },
```

Import `AdminGuard` at the top: `import { AdminGuard } from '@/components/auth/AdminGuard';`.

- [ ] **Step 4: Sidebar entries**

In `src/components/layout/Sidebar.tsx`, find the existing accounting section (the entries pointing to `/accounting/onboarding`, `/accounting/clients`, `/accounting/recurring`). Add two new entries directly below, gated on `isAdmin`:

```tsx
{isAdmin && (
  <>
    <SidebarLink to="/accounting/report" label={t('accounting_report:nav.report')} />
    <SidebarLink to="/accounting/expenses" label={t('accounting_report:nav.expenses')} />
  </>
)}
```

(Use whatever the existing `SidebarLink` / `NavLink` component is — match the existing pattern verbatim. `isAdmin` should already be available via the same hook the other admin-only entries use; grep for an existing `isAdmin &&` block in the file.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/router.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(accounting): /accounting/report + /accounting/expenses routes (admin)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 36: `useDealPayments` — accept `amountNet` + `vatRate`

**Files:**
- Modify: `src/features/deals/hooks/useDealPayments.ts`
- Modify: `src/features/deals/hooks/useDealPayments.test.tsx` (if it exists) or create it.

- [ ] **Step 1: Inspect the existing hook**

Run: `cat src/features/deals/hooks/useDealPayments.ts`

Identify the mutations (`useCreatePayment`, `useUpdatePayment`, or similar named exports) that today take an `amount` field.

- [ ] **Step 2: Write/extend the failing test**

```tsx
// src/features/deals/hooks/useDealPayments.test.tsx (add or extend)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type PropsWithChildren } from 'react';
import { useCreatePayment, useUpdatePayment } from './useDealPayments';

const single = vi.fn();
const select = vi.fn(() => ({ single }));
const eq = vi.fn(() => ({ select }));
const update = vi.fn(() => ({ eq }));
const insert = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ insert, update })) },
}));

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDealPayments — VAT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'p1', amount_net: 100, amount_gross: 124 }, error: null });
  });

  it('useCreatePayment inserts amount_net + vat_rate, not amount', async () => {
    const { result } = renderHook(() => useCreatePayment(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'd1', billingType: 'one_time', startDate: '2026-06-01',
        amountNet: 100, vatRate: 24,
      });
    });
    const payload = insert.mock.calls[0][0];
    expect(payload.amount_net).toBe(100);
    expect(payload.vat_rate).toBe(24);
    expect(payload.amount).toBeUndefined();
  });

  it('useUpdatePayment patches amount_net + vat_rate', async () => {
    const { result } = renderHook(() => useUpdatePayment(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'p1', patch: { amountNet: 200, vatRate: 13 } });
    });
    expect(update).toHaveBeenCalledWith({ amount_net: 200, vat_rate: 13 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- useDealPayments`
Expected: FAIL — current hook either writes `amount` or doesn't expose those mutations under that shape.

- [ ] **Step 4: Update the hook**

Edit each mutation in `useDealPayments.ts` so its input shape uses `amountNet` + `vatRate` and the Supabase payload uses `amount_net` + `vat_rate`. Remove any code that writes the deprecated `amount` column.

A representative diff (the actual edit must match the existing file's structure — names of types and functions are dictated by what's there):

```ts
// before
export type CreatePaymentInput = {
  dealId: string;
  billingType: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amount: number;
  startDate: string;
  endDate?: string | null;
  serviceType?: string | null;
};
// …
await supabase.from('deal_payments').insert({
  deal_id: input.dealId,
  billing_type: input.billingType,
  amount: input.amount,
  start_date: input.startDate,
  end_date: input.endDate ?? null,
  service_type: input.serviceType ?? null,
});

// after
export type CreatePaymentInput = {
  dealId: string;
  billingType: 'one_time' | 'recurring_monthly' | 'recurring_yearly';
  amountNet: number;
  vatRate: number;
  startDate: string;
  endDate?: string | null;
  serviceType?: string | null;
};
// …
await supabase.from('deal_payments').insert({
  deal_id: input.dealId,
  billing_type: input.billingType,
  amount_net: input.amountNet,
  vat_rate: input.vatRate,
  start_date: input.startDate,
  end_date: input.endDate ?? null,
  service_type: input.serviceType ?? null,
});
```

Apply the equivalent change to the update mutation: its patch type swaps `amount?: number` → `amountNet?: number; vatRate?: number;`, and the `toDbPatch` mapping writes `amount_net` / `vat_rate`.

- [ ] **Step 5: Run typecheck — call-sites will break**

Run: `npm run typecheck`
Expected: errors at every caller still passing `amount`. Fix each by computing net + vatRate. If a caller has only the legacy gross value:

```ts
const vatRate = 24;
const amountNet = round(gross / (1 + vatRate / 100), 2); // see Math.round * 100 / 100 idiom
```

(Pattern is acceptable here because the existing call-site already trusted 24%; everywhere a real net is available, prefer passing it directly.)

- [ ] **Step 6: Re-run all related tests**

Run: `npm test -- deals`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/deals/hooks/useDealPayments.ts \
        src/features/deals/hooks/useDealPayments.test.tsx \
        $(git status --porcelain | awk '/^.M src\/.*deal.*\.tsx?$/ {print $2}')
git commit -m "feat(deals): payment mutations write amount_net + vat_rate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 37: Deal payments UI — Net / VAT / Gross display

**Files:**
- Modify: the existing deal-payments UI component(s). Find them first with `grep -rn "amount_gross\|amount\\b" src/features/deals/components 2>/dev/null | head`.

There is no single canonical component to point at because the existing app may show payment amount in more than one place (deal payments tab, recurring kanban card, payment edit dialog). Sweep them in this one task.

- [ ] **Step 1: Inventory the touch-points**

Run:
```bash
grep -rn "amount\b" src/features/deals/components src/features/accounting --include="*.tsx" | grep -v "amount_gross\|amount_net\|amount_paid\|total_amount" | head
```

For each result that renders a deal-payment amount, add it to the change list.

- [ ] **Step 2: For each payment-editing surface, replace the single Amount field with Net / VAT% / Gross**

Pattern (apply to every form):

```tsx
// before
<label>
  Amount
  <input
    type="number" step="0.01" min="0"
    value={amount} onChange={(e) => setAmount(Number(e.target.value))}
  />
</label>

// after
<label>
  Net
  <input
    type="number" step="0.01" min="0"
    value={amountNet} onChange={(e) => setAmountNet(Number(e.target.value))}
  />
</label>
<label>
  VAT %
  <input
    type="number" step="0.01" min="0" max="100"
    value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))}
  />
</label>
<div>
  Gross
  <div className="rounded border bg-neutral-50 px-2 py-1">
    €{(amountNet + (amountNet * vatRate) / 100).toFixed(2)}
  </div>
</div>
```

- [ ] **Step 3: For each payment-display surface, switch from `amount` → `amount_gross`**

The recurring kanban card stays gross-only (that's what the bank sees). Tables that previously showed a single Amount column should now show three columns (Net / VAT / Gross) to match the new report.

- [ ] **Step 4: Add or extend a snapshot/regression test on the payments tab**

If a `DealPaymentsTab` test exists, add: "renders amount_gross for an existing recurring row backfilled with amount_net=100, vat_rate=24" — assert `124.00` appears. If no test exists, create a small one matching the existing component test conventions.

- [ ] **Step 5: Typecheck + run tests**

```
npm run typecheck
npm test -- deals
```
Expected: clean + green.

- [ ] **Step 6: Commit**

```bash
git add $(git status --porcelain | awk '/^.M src\/features\/(deals|accounting)\/.*\.tsx?$/ {print $2}')
git commit -m "feat(deals,accounting): payment UI shows Net / VAT / Gross

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 38: Manual E2E + Playwright smoke

**Files:**
- Create: `e2e/accounting-report.spec.ts`

- [ ] **Step 1: Make sure the dev server is running**

Run (in another shell): `npm run dev` — note the local URL.

- [ ] **Step 2: Manual UAT against the smoke account**

Drive the UI as `test@test.gr` / `123456789`:

1. Log in. Sidebar shows **Report** and **Expenses** under Accounting (admin-only).
2. Navigate to `/accounting/report`. KPI tiles render zero state cleanly when no data in the current month.
3. Click **+ New expense**. Submit blocked without category. Pick `Rent`, vendor `Building Ltd`, net `500`, VAT `24`, start `2026-06-01`, click **Save & mark paid**. Dialog closes; KPI tiles update; expense breakdown row appears.
4. Click the expense breakdown row → drawer opens with the new row. Click the row → expense detail dialog opens.
5. Upload a small PDF receipt. Confirm the detail closes/refreshes and the receipt path is set (re-open detail → "View receipt" appears).
6. Create a `recurring_monthly` expense (Software / Adobe / 50 net / 24 VAT / start 2026-06-01). Should default end_date to 2026-07-01.
7. Run the renewal manually in SQL editor: `select public.ensure_recurring_expenses();`. Re-open `/accounting/expenses`, filter by Pending — the July successor row exists.
8. Switch range preset to "Last month" then "This year". Numbers update correctly.
9. Open **Export → Download CSV** — confirm the file downloads with rows matching the visible data. Then **Download PDF** — confirm KPI tiles appear in the PDF.
10. Log out and log back in as a non-admin smoke user (or a member of a non-admin group). Confirm the sidebar entries are **hidden** and `/accounting/report` redirects/blocks.

If any step fails, fix the underlying issue and amend the relevant earlier task before continuing.

- [ ] **Step 3: Add a Playwright smoke**

```ts
// e2e/accounting-report.spec.ts
import { test, expect } from '@playwright/test';

test.describe('accounting report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/email/i).fill('test@test.gr');
    await page.getByLabel(/password/i).fill('123456789');
    await page.getByRole('button', { name: /sign in|log in|είσοδος/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('admin creates a paid expense and sees it land in the breakdown', async ({ page }) => {
    await page.goto('/accounting/report');
    await expect(page.getByRole('heading', { name: /accounting report|λογιστική αναφορά/i })).toBeVisible();

    await page.getByRole('button', { name: /\+ new expense|\+ νέο έξοδο/i }).click();
    await page.getByLabel(/category|κατηγορία/i).selectOption({ label: /rent|ενοίκιο/i });
    await page.getByLabel(/vendor|προμηθευτής/i).fill('Playwright Vendor');
    await page.getByLabel(/amount.*net|καθαρό/i).fill('100');
    await page.getByLabel(/start date|ημ\/νία έναρξης/i).fill('2026-06-15');
    await page.getByRole('button', { name: /save & mark paid|σήμανση πληρωμένου/i }).click();

    await expect(page.getByText('Playwright Vendor')).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 4: Run the smoke**

Run: `npx playwright test e2e/accounting-report.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite as a final guardrail**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit any incidental fixes**

If steps 2–5 surfaced fixes, group them into focused commits with `fix(accounting): …` messages, then commit the new smoke spec on its own:

```bash
git add e2e/accounting-report.spec.ts
git commit -m "test(accounting): Playwright smoke for create-paid-expense flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 39: Backfill the spec's "Changes / Revert" section + push

**Files:**
- Modify: `docs/superpowers/specs/2026-06-01-accounting-report-design.md`

- [ ] **Step 1: Collect the per-step commit list**

Run:
```bash
git log --oneline --reverse --since=2026-06-01 | grep -E '(feat\(db\)|feat\(accounting\)|feat\(deals\)|feat\(i18n\)|feat\(query\)|test\(accounting\)|fix\(accounting\)|fix\(deals\))'
```

Capture the output.

- [ ] **Step 2: Rewrite the "Changes / Revert" section**

Replace the placeholder section in the spec with a structured list of commit hashes grouped by phase (DB, i18n + query keys, hooks, components, pages, routes, deal-payments UI, smoke). Each line: `<hash> <commit subject>`.

End the section with:

```
**Full revert order (most-recent first):**
1. Smoke test commit
2. Deal-payments UI changes
3. useDealPayments hook changes
4. Routes + sidebar
5. Pages
6. Components
7. Hooks
8. queryKeys
9. i18n namespace
10. Cron extension migration (`20260601000008`)
11. P&L summary view migration (`20260601000007`)
12. Ledger view migration (`20260601000006`)
13. deal_payments VAT migration (`20260601000005`)
14. ensure_recurring_expenses function migration (`20260601000004`)
15. expense-receipts bucket migration (`20260601000003`)
16. expenses table migration (`20260601000002`)
17. expense_categories table migration (`20260601000001`)

Revert by `git revert <hash>` (frontend) or by writing an inverse SQL migration that runs each migration's `-- ROLLBACK:` block in reverse order (DB).
```

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers/specs/2026-06-01-accounting-report-design.md
git commit -m "$(cat <<'EOF'
docs(spec): backfill Changes / Revert section for accounting report

Captures every commit shipped under this spec so any single piece
can be reverted independently and the full feature can be peeled
off cleanly in the order specified.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

Expected: clean push. Vercel preview deploys and the report lands at `/accounting/report` for admins.

---

## Self-Review

**1. Spec coverage**
- `expense_categories` + 15-row seed + RLS → Task 1 ✓
- `expenses` table + generated columns + indexes + RLS → Task 2 ✓
- Receipts Storage bucket + admin-only policy → Task 3 ✓
- `ensure_recurring_expenses()` + `parent_expense_id` chain logic → Task 4 ✓
- `deal_payments` VAT columns + backfill + updated RPCs → Task 5 ✓
- `accounting_ledger_v` + `accounting_pl_summary_v` views → Tasks 6, 7 ✓
- Daily cron extension → Task 8 ✓
- i18n EN + EL → Task 9 ✓
- queryKeys → Task 10 ✓
- Read hooks: useExpenseCategories, useExpenses, useExpensesRealtime, useLedger, usePLSummary, useMRR → Tasks 11, 12, 13, 14, 15, 32 ✓
- Mutation hooks: useCreateExpense, useUpdateExpense, useMarkExpensePaid, useDeleteExpense, useUploadReceipt → Tasks 16, 17, 18, 19, 20 ✓
- Detail hook: useExpenseDetail → folded into Task 27 ✓
- Utils: formatRange, exportCSV, exportPDF → Tasks 21, 22, 23 ✓
- Components: ExportMenu, ExpenseRow, NewExpenseDialog, ExpenseDetailDialog, TransactionDrawer, IncomeBreakdown, ExpenseBreakdown, ReportHeader → Tasks 24, 25, 26, 27, 28, 29, 30, 31 ✓
- Pages: ReportPage, ExpensesPage → Tasks 33, 34 ✓
- Route guards + sidebar → Task 35 ✓
- Deal-payments hook + UI VAT update → Tasks 36, 37 ✓
- Manual UAT + Playwright smoke → Task 38 ✓
- Changes / Revert backfill → Task 39 ✓

No gaps.

**2. Placeholder scan**
- No "TBD", "TODO", "implement later", "similar to Task N", or hand-wavy "add error handling" anywhere — every code step contains real code.
- Three task-level call-outs intentionally describe a sweep instead of pointing at one file: Task 35 (sidebar location depends on existing Sidebar.tsx structure), Task 36 (existing call-sites to `useCreatePayment` / `useUpdatePayment` are spread across the deals + accounting features and need a typecheck-driven sweep), Task 37 (multiple payment-rendering surfaces). Each spells out exactly how to find them (`grep` recipes) and gives a representative diff. This is intentional — the alternative would be inventing concrete paths I haven't verified.

**3. Type consistency**
- `ExpenseRow` data type (from `useExpenses`) is exported and re-imported by `ExpenseRow` (component), `ExpenseDetailDialog`, and `useExpenseDetail`. Field names match the DB columns exactly: `amount_net`, `vat_rate`, `vat_amount`, `amount_gross`, `start_date`, `end_date`, `status`, `payment_method`, `paid_at`, `paid_by`, `receipt_path`, `parent_expense_id`, `category`.
- `LedgerRow` shape stays identical across `useLedger`, `IncomeBreakdown`, `ExpenseBreakdown`, `TransactionDrawer`, `exportCSV`, `exportPDF`.
- `PLSummary` shape (camelCase JS fields) stays identical across `usePLSummary`, `ReportHeader`, `ExportMenu`, `ReportPage`, `exportPDF`.
- `CreateExpenseInput` camelCase matches the DB snake_case mapping in `useCreateExpense` — confirmed by reading both side-by-side. Same check passed for `UpdateExpensePatch`.
- `RangePreset` union (`'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom'`) is identical in `formatRange.ts` and `ReportHeader.tsx`.
- Storage bucket id `'expense-receipts'` is used identically in `useUploadReceipt` and the migration. Path convention `{expenseId}/{uuid}-{name}` matches the test expectation.

All checks pass.
