# Accounting report — incomes + expenses with VAT — design

**Status:** Draft (awaiting user review)
**Author:** Marios (via Claude)
**Date:** 2026-06-01

## Goal

A fully detailed accounting report inside the CRM that shows, for any date range, every euro the company brings in and every euro it spends, with VAT broken out on both sides. Recurring monthly/yearly expenses are first-class — they auto-extend the same way recurring incomes already do. Admin-only at launch; designed so the owner can verify P&L without leaving the CRM.

## Scope

**In scope**

- New tables `expense_categories` and `expenses`.
- New private Storage bucket `expense-receipts`.
- Recurrence engine for expenses (`ensure_recurring_expenses()`) wired into the existing daily `pg_cron` job.
- VAT split on `deal_payments` (`amount_net`, `vat_rate`, generated `vat_amount`, generated `amount_gross`) with backfill.
- Two Postgres views — `accounting_ledger_v` (combined income + expense rows) and `accounting_pl_summary_v` (period totals).
- Frontend feature `src/features/accounting-report/` — report page at `/accounting/report`, flat expense list at `/accounting/expenses`, create/detail dialogs, CSV + PDF export.
- RLS + route guard locking everything to `is_admin`.
- i18n EN + EL keys.
- Realtime invalidation for `expenses`.
- pgTAP-style SQL tests, Vitest hook + component tests, one Playwright smoke.

**Out of scope (v1)**

- A second permission key (`accounting_report`) for non-admin owner access — flagged as a follow-up if/when a non-admin owner exists.
- Vendor table / vendor-level reporting beyond "top vendors by free-text name".
- Multi-currency. EUR only, matching the rest of the CRM (Phase 8 spec stub keeps multi-currency deferred).
- Charts / graphical dashboard. Owner-facing tables + KPI tiles only; charts can come later if requested.
- Email digests or scheduled reports.
- Reconciliation against bank statements.
- Reimbursement workflow for employee-paid expenses (the `paid_by` field is there for later use).
- Dropping the legacy `deal_payments.amount` column — kept for one release as a safety net, removed in a follow-up migration.

## Data model

### `expense_categories`

```sql
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
```

Seeded rows (key, name_en, name_el, sort_order):

| key                | name_en              | name_el                |
| ------------------ | -------------------- | ---------------------- |
| `salaries`         | Salaries             | Μισθοί                 |
| `freelancers`      | Freelancers          | Εξωτερικοί συνεργάτες  |
| `rent`             | Rent                 | Ενοίκιο                |
| `utilities`        | Utilities            | Λογαριασμοί κοινής ωφέλειας |
| `software`         | Software             | Λογισμικό              |
| `hosting_domains`  | Hosting & Domains    | Φιλοξενία & Domains    |
| `ads_spend`        | Ads spend            | Διαφημιστική δαπάνη    |
| `equipment`        | Equipment            | Εξοπλισμός             |
| `taxes_vat`        | Taxes / VAT          | Φόροι / ΦΠΑ            |
| `accountant_fees`  | Accountant fees      | Λογιστικά              |
| `bank_fees`        | Bank fees            | Τραπεζικά έξοδα        |
| `marketing`        | Marketing            | Marketing              |
| `training`         | Training             | Εκπαίδευση             |
| `travel`           | Travel               | Μετακινήσεις           |
| `other`            | Other                | Άλλο                   |

Archive (not delete) is the only way to retire a category — preserves historical names on old expense rows.

**Rollback:**

```sql
-- ROLLBACK:
-- drop table if exists public.expense_categories cascade;
```

### `expenses`

```sql
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
```

**Notes**

- `parent_expense_id` identifies a recurrence chain: the first row in a chain has it `null`, every successor points at the chain root. Cleaner than reusing `service_index` (which only makes sense inside an ordered service list on a deal) and lets two simultaneous recurring expenses with the same vendor + category coexist without collision.
- `vendor` is free text (per Q4 answer) — no vendors table yet.
- `vat_rate` defaults to 24 (Greek standard) but is editable per row to handle 13 % / 6 % / 0 % cases.
- The `paid_by` column is set by the app on `markPaid` (defaults to current user). It's the only reference to `profiles`; deleting a profile leaves a null `paid_by`, which is fine because admin-only RLS already gates the data.

**Rollback:**

```sql
-- ROLLBACK:
-- drop table if exists public.expenses cascade;
```

### `expense-receipts` Storage bucket

Private bucket. Policy on `storage.objects`:

```sql
insert into storage.buckets (id, name, public)
  values ('expense-receipts', 'expense-receipts', false)
  on conflict (id) do nothing;

create policy expense_receipts_all on storage.objects
  for all to authenticated
  using (bucket_id = 'expense-receipts' and public.current_user_is_admin())
  with check (bucket_id = 'expense-receipts' and public.current_user_is_admin());
```

File path convention: `expense-receipts/{expense_id}/{uuid}-{sanitised-original-filename}`.

Frontend fetches via signed URLs (1-hour expiry). MIME allowlist enforced in the upload hook: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`. Size cap 10 MB.

**Rollback:**

```sql
-- ROLLBACK:
-- drop policy if exists expense_receipts_all on storage.objects;
-- delete from storage.buckets where id = 'expense-receipts';
```

### `deal_payments` VAT additions

Existing table; income side gets the same net/VAT/gross shape as expenses so the report reconciles.

```sql
alter table public.deal_payments
  add column if not exists amount_net numeric(12,2),
  add column if not exists vat_rate numeric(5,2) not null default 24.00,
  add column if not exists vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column if not exists amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- Backfill: current `amount` column holds the gross figure today.
update public.deal_payments
  set amount_net = round(amount / 1.24, 2)
  where amount_net is null and amount is not null;

alter table public.deal_payments
  alter column amount_net set not null,
  add constraint deal_payments_amount_net_nonneg check (amount_net >= 0),
  add constraint deal_payments_vat_rate_bounded check (vat_rate >= 0 and vat_rate <= 100);

comment on column public.deal_payments.amount is
  'DEPRECATED: gross amount. Read amount_gross instead. Will be dropped after 2026-07-01.';
```

`seed_deal_payments()` and `ensure_recurring_payments()` are updated in the same migration to write `amount_net = round(gross_from_services_planned / (1 + vat_rate/100), 2)` instead of writing `amount`. The legacy `amount` column stays nullable and is no longer written, but reads from older code paths keep working until the follow-up drop migration ships.

**Verification step (migration logs a notice on mismatch):**

```sql
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
```

**Rollback:**

```sql
-- ROLLBACK:
-- alter table public.deal_payments
--   drop column if exists amount_net,
--   drop column if exists vat_rate,
--   drop column if exists vat_amount,
--   drop column if exists amount_gross;
-- (seed_deal_payments + ensure_recurring_payments must also be reverted to the pre-migration definitions.)
```

## Recurrence engine

```sql
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
```

Idempotent: the `not exists` guard prevents double-creation. Successor inherits the predecessor's net amount, VAT rate, vendor, category, and notes; `status` is reset to `pending`; `paid_at`, `paid_by`, `payment_method`, and `receipt_path` are not copied.

The existing daily `pg_cron` job (registered in `20260503000014_ensure_recurring_payments_daily_cron.sql`) is extended to also call `ensure_recurring_expenses()` — single new migration, no new cron entry.

## Views

```sql
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
```

`security_invoker = true` is the load-bearing setting — it ensures non-admins querying the views get filtered by the underlying RLS, never the view owner's superuser context.

## RLS & permissions

| Surface                  | Policy                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| `expense_categories` SELECT | any authenticated (labels render on dropdowns without leaking spend data) |
| `expense_categories` write  | `current_user_is_admin()` only                                            |
| `expenses` all          | `current_user_is_admin()` only                                                |
| `expense-receipts` bucket | `current_user_is_admin()` only                                              |
| Views                    | `security_invoker = true` — inherits underlying table RLS                    |
| Routes `/accounting/report`, `/accounting/expenses` | `RequireAdmin` wrapper                                  |
| Sidebar entries          | hidden when `!isAdmin`                                                       |

No new permission key is introduced. The existing `current_user_is_admin()` helper is the entire gate.

## Frontend

Route map additions:

```
/accounting/report     → ReportPage      (admin)
/accounting/expenses   → ExpensesPage    (admin)
```

Folder:

```
src/features/accounting-report/
  components/
    ReportHeader.tsx          // range picker + KPI tiles + export menu
    IncomeBreakdown.tsx       // table grouped by service_type, click → drawer
    ExpenseBreakdown.tsx      // table grouped by category, click → drawer + "+ New expense"
    TransactionDrawer.tsx     // raw rows behind a clicked breakdown cell
    NewExpenseDialog.tsx
    ExpenseDetailDialog.tsx   // read + edit + upload receipt + mark paid
    ExpenseRow.tsx
    ExportMenu.tsx
  hooks/
    usePLSummary.ts
    useLedger.ts
    useExpenses.ts
    useCreateExpense.ts
    useUpdateExpense.ts
    useMarkExpensePaid.ts
    useDeleteExpense.ts
    useExpenseCategories.ts
    useUploadReceipt.ts
  pages/
    ReportPage.tsx
    ExpensesPage.tsx
  utils/
    formatRange.ts
    exportCSV.ts
    exportPDF.ts
  __tests__/
```

### `ReportPage` layout

1. **Header bar** — range control (`This month` default | `Last month` | `This year` | `Last year` | custom from–to) + export menu.
2. **Four KPI tiles** — Total Income (gross + net subtitle), Total Expenses (gross + net subtitle), Net Profit (gross + net), MRR (sum of `recurring_monthly` paid `deal_payments` whose period overlaps the range).
3. **Income breakdown table** — rows grouped by `service_type` (web_seo, local_seo, web_dev, social_media, ads, hosting_domains, …), columns: count, net, VAT, gross, % of income. Row click → `TransactionDrawer` showing the underlying paid `deal_payments`.
4. **Expense breakdown table** — rows grouped by category, columns: count, net, VAT, gross, % of expenses. Row click → drawer of underlying `expenses`. Table header has a `+ New expense` button.
5. **Sticky YTD footer** — YTD income / expense / net profit displayed alongside the current-range numbers so the owner always sees both.

### `ExpensesPage` layout

Flat searchable list with filters: status (pending / paid / all), category, vendor (text), billing_type, date range. Click a row → `ExpenseDetailDialog`. Bulk-mark-paid action via row checkboxes + toolbar button (admin convenience for the monthly cron output).

### `NewExpenseDialog` fields

Category (required select), Vendor (text), Billing type (segmented: One-time / Monthly / Yearly), Amount net (required, EUR), VAT rate (default 24, editable), Gross (read-only computed display), Start date (required), End date (auto-filled by billing_type, editable), Payment method, Paid by (defaults to current user — only set when status flips to paid), Notes, Receipt upload (deferred to `ExpenseDetailDialog` if the upload happens after creation). Submit creates the row in `pending`. A secondary "Mark paid now" button flips status + paid_at + payment_method in the same RPC-less call sequence.

### Realtime

Subscribe to the `expenses` channel on `ReportPage` and `ExpensesPage` mount, invalidate the relevant query keys on insert/update/delete. Mirror the pattern in `useDealPaymentsRealtime`.

### `deal_payments` UI touch-points

Anywhere the existing app shows a single `amount` field on `deal_payments` (the deal Payments tab, the create/edit dialog), replace with **Net / VAT % / Gross** triplet — net editable, VAT rate editable (default 24), gross read-only. The kanban card on `/accounting/recurring` keeps displaying gross only (that's what the bank shows). The mutation hooks (`useCreatePayment`, `useUpdatePayment`) accept `amountNet` + `vatRate`; the old `amount` arg is removed.

## i18n

New translation keys under `accountingReport.*` (EN + EL), covering: page titles, KPI tile labels, breakdown column headers, expense form labels, button labels, range picker presets, status badges, export menu items, empty states, confirmation dialogs. Greek strings drafted in the spec table for `expense_categories` above; remaining UI strings drafted alongside the implementation plan.

## Export

CSV (one row per ledger entry) generated client-side from the currently-rendered range — same dataset as the drilldown drawer would show, no extra query. Columns: `event_date`, `period`, `direction`, `status`, `category_key`, `counterparty`, `billing_type`, `amount_net`, `vat_rate`, `vat_amount`, `amount_gross`, `payment_method`, `notes`. Filename: `accounting-{from}-to-{to}.csv`.

PDF generated client-side. Uses the same react-pdf / pdf-lib library already in `package.json` if one is present; otherwise jsPDF + html2canvas. Layout mirrors the on-screen report: KPI tiles → income breakdown → expense breakdown → YTD footer. Filename: `accounting-{from}-to-{to}.pdf`.

## Testing strategy

**DB tests** (pgTAP-style SQL):

- `expense_categories_seed.sql` — 15 rows, all keys present, all `archived = false`.
- `expenses_rls.sql` — admin can CRUD; a user with every other permission gets zero rows on SELECT and `permission denied` on INSERT.
- `expenses_generated_columns.sql` — net=100 / vat=24 → vat_amount=24, gross=124; update net to 200 → vat_amount=48, gross=248.
- `expenses_check_constraints.sql` — `status='paid'` without `paid_at` rejected; `paid` without `payment_method` rejected; negative `amount_net` rejected; `vat_rate > 100` rejected; `end_date < start_date` rejected.
- `ensure_recurring_expenses.sql` — recurring_monthly row with `end_date = today + 3 days` produces exactly one successor with `parent_expense_id` pointing at the chain root; second call produces none; two recurring rows that share vendor + category but have different chain roots each produce their own successor; one_time rows never extended; `paid_at`/`paid_by`/`receipt_path` not copied to successor.
- `deal_payments_vat_backfill.sql` — every existing row's `amount_gross` is within €0.02 of the legacy `amount`; sum(net + vat) equals sum(gross) for the whole table.
- `accounting_ledger_v.sql` — a paid `deal_payment` + a paid `expense` show up with correct direction/period/gross; pending rows excluded from `accounting_pl_summary_v`; admin sees both; non-admin sees no expense rows.

**Hook tests** (Vitest, Supabase client mocked):

- `useExpenses` — filters compose correctly; realtime invalidates the cache; ordering is `start_date desc`.
- `useCreateExpense` — payload shape; validation errors surface to the form; optimistic cache update reverts on error.
- `useMarkExpensePaid` — sets `status='paid'` + `paid_at=now()` + `payment_method` + `paid_by=current_user` atomically.
- `useUploadReceipt` — uploads to the correct storage path; updates `expense.receipt_path`; rejects oversize / wrong-MIME files before hitting Storage.
- `usePLSummary` — assembles KPI numbers from `accounting_pl_summary_v`; net profit = income − expense; MRR derived only from `recurring_monthly` paid rows.
- `useDealPayments` (regression) — round-trips a row created with `amountNet=100, vatRate=24` and reads back `amountGross=124`.

**Component tests** (Vitest + Testing Library):

- `NewExpenseDialog` — required-field validation; default VAT rate; billing_type changes auto-fill end_date; category dropdown reads from `useExpenseCategories`; paid-now shortcut writes both status and paid_at.
- `ExpenseDetailDialog` — receipt upload flow; signed-URL render; mark-paid path; edit + cancel.
- `ReportPage` — range picker drives all sections; drilldown drawer opens with the correct slice; KPI tiles render zero state correctly; YTD footer stays in sync.
- `ExportMenu` — CSV row count matches drilldown count for the same range; PDF generation invoked with the expected payload.
- `DealPaymentsTab` (regression) — entering net auto-computes gross display; entering custom VAT rate updates gross live; existing payments display correctly post-backfill.

**E2E smoke** (Playwright, runs against `test@test.gr` / `123456789`):

- Log in → navigate to `/accounting/report` → create a one-time expense → mark paid → assert it appears in the Expense breakdown and lowers Net Profit by exactly its gross amount.
- Create a `recurring_monthly` expense → call `ensure_recurring_expenses()` manually → assert successor row exists in next month's bucket with the same vendor/category/net/VAT.

**Coverage gate** — same project threshold; new files must hit it. Tests run in CI on every push.

## Migration & rollout

Migration files under `supabase/migrations/`, dated `20260601000001…` upward:

1. `…01_expense_categories.sql` — table, seed, RLS, trigger.
2. `…02_expenses.sql` — table, generated columns, indexes, RLS, triggers.
3. `…03_expense_receipts_bucket.sql` — Storage bucket + policy.
4. `…04_ensure_recurring_expenses.sql` — function + grant.
5. `…05_deal_payments_vat.sql` — VAT columns + backfill + updated `seed_deal_payments` + updated `ensure_recurring_payments` + verification notice.
6. `…06_accounting_ledger_view.sql` — `accounting_ledger_v`.
7. `…07_accounting_pl_summary_view.sql` — `accounting_pl_summary_v`.
8. `…08_recurring_expenses_daily_cron.sql` — extend existing daily cron entry to also call `ensure_recurring_expenses()`.

Each migration carries its own `-- ROLLBACK:` block (drafted inline in the data-model section above; full rollback SQL belongs in each migration file).

**No backfill required** for expenses — table starts empty; admin populates via the UI. Incomes backfill happens inside migration 5 above.

**Feature visibility ramp**

- Day 1: migrations land; routes mount behind `RequireAdmin`; no announcement.
- Day 1 onward: admin starts entering this month's expenses to validate the form, VAT math, and recurrence.
- Day 7: confirm the daily cron actually fired (or trigger `ensure_recurring_expenses()` manually) and the successors look right.
- After ~one full month of real use, decide which is the income source of truth in production: `deal_payments` (current report) or `monthly_invoices`.

**Commit cadence** — one per migration, one per hook, one per component, one per page, one per i18n keyset. Per `feedback_no_prs`, push straight to main; per `feedback_track_changes_for_revert`, every commit hash lands in the **Changes / Revert** section once the implementation completes.

## Open questions

1. **`monthly_invoices` vs `deal_payments` overlap.** Both can carry the same recurring money depending on which path accounting uses each month. The report counts only `deal_payments`. Will revisit after the first real month of use to decide which is canonical and whether the other should be excluded from the schema or just from the report.
2. **Legacy `deal_payments.amount` column.** Stays for one release as a safety net. Drop in a follow-up migration after 2026-07-01 once we've confirmed nothing else reads it.
3. **Non-admin owner access.** If an owner is added later who is not `is_admin`, introduce an `accounting_report` permission key with view/edit and switch the RLS + route guard to use it. Out of scope today because that user does not exist.
4. **Salaries privacy.** Admin-only today is fine; if a non-admin owner is added in (3), payroll-line detail should probably be hidden from non-admin readers via a sub-permission. Defer until that user exists.

## Changes / Revert

This section will be backfilled at the end of implementation with the actual commit hashes (per `feedback_track_changes_for_revert`). Tracked here so the structure is reserved:

- Migrations 1–8 listed above — rollback SQL in each migration's `-- ROLLBACK:` block.
- Hook commits (`feat(accounting): …`) — revert by `git revert <hash>`.
- Component commits — revert by `git revert <hash>`.
- Page commits — revert by `git revert <hash>`.
- i18n commits — revert by `git revert <hash>`.

Complete revert order (most-recent first): components/pages/hooks/i18n → views → cron extension → `deal_payments` VAT columns → `ensure_recurring_expenses` function → receipts bucket → `expenses` table → `expense_categories` table.
