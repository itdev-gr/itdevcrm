# Accounting Report — Smoke-Test Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 15 bugs and process gaps surfaced by the 2026-06-01 visual + code smoke test of the accounting report, in priority order: accounting integrity first, UX clarity second, defensive code + process hygiene third.

**Architecture:** Most fixes are surgical edits to existing files. The one structural change is bumping `deal_payments.amount_net` and `expenses.amount_net` precision from `numeric(12,2)` to `numeric(12,4)` so VAT math round-trips exactly — the canonical bank-visible gross stays at 2dp, the net stores enough precision that `round(net × (1 + vat/100), 2) = gross` for every row.

**Tech Stack:** Same as the parent feature — Supabase Postgres + React + TanStack Query + Tailwind + Vitest + Playwright.

**Reference spec:** `docs/superpowers/specs/2026-06-01-accounting-report-design.md` (open questions 1–4 remain open and are out of scope for this plan).

---

## File Structure

**New DB migration:**
- `supabase/migrations/20260601100001_amount_net_precision_4dp.sql` — widen `amount_net` precision on both `deal_payments` and `expenses`, re-backfill with higher precision.

**Modified files:**
- `src/features/deals/PaymentsPanel.tsx` — read deal's client country, default `vatRate` per country, add "Billing type" label (Task 8 also touches this if reused pattern).
- `src/features/accounting_report/components/IncomeBreakdown.tsx` — translate `category_key` via `services.types.*` namespace.
- `src/features/accounting_report/components/TransactionDrawer.tsx` — translate drawer title + `billing_type` column; add backdrop with click-to-close.
- `src/features/accounting_report/components/ExpenseDetailDialog.tsx` — format `paid_at`, hide redundant one-time date range, translate billing_type.
- `src/features/accounting_report/components/NewExpenseDialog.tsx` — add "Billing type" label, hoist the segmented buttons under a labeled group.
- `src/features/accounting_report/components/ExportMenu.tsx` — close on outside-click.
- `src/features/accounting_report/components/ReportPage.tsx` — pass translated title into the drawer.
- `src/features/offers/OfferBuilderPage.tsx` — refactor the two set-state-in-effect violations into `useMemo` + event handlers.
- `src/components/layout/Sidebar.tsx` — replace hard-coded section headers with i18n keys.
- `src/i18n/locales/{en,el}/common.json` — add `nav.section.sales`, `nav.section.accounting`, `nav.section.technical`.
- `src/i18n/locales/{en,el}/accounting_report.json` — add `billing.one_time` / `billing.recurring_monthly` / `billing.recurring_yearly` (drawer column translation).
- `package.json` — add `build` step that runs lint after typecheck so Vercel catches regressions.

**Non-code action (post-plan checklist):**
- Rotate the Supabase access token used during deployment.

---

## Tasks

### Task 1: New payment rows default VAT rate from deal's client country

**Severity:** Major — integrity. New rows on Cyprus deals were defaulting to 24% VAT.

**Files:**
- Modify: `src/features/deals/PaymentsPanel.tsx`
- Modify: `src/features/deals/DealDetailPage.tsx` (or wherever `<PaymentsPanel dealId={...} services={...} />` is rendered — confirm in step 1)
- Test: `src/features/deals/PaymentsPanel.test.tsx` (create if missing)

- [ ] **Step 1: Locate the call-site and confirm what data is available**

Run: `grep -rn "PaymentsPanel" src/features/deals --include="*.tsx" | head`

The deal detail page should already have access to the deal's `client.country`. The cleanest fix: pass `clientCountry` (or just `defaultVatRate`) as a prop into `PaymentsPanel`.

- [ ] **Step 2: Write the failing test**

```tsx
// src/features/deals/PaymentsPanel.test.tsx (new file)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { PaymentsPanel } from './PaymentsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('./hooks/useDealPayments', () => ({
  useDealPayments: () => ({ data: [], isLoading: false }),
  useAddDealPayment: () => ({ mutateAsync: vi.fn() }),
  useUpdateDealPayment: () => ({ mutateAsync: vi.fn() }),
  useDeleteDealPayment: () => ({ mutateAsync: vi.fn() }),
}));

function wrap(c: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('PaymentsPanel default VAT rate', () => {
  it('defaults VAT rate to 24 for Greek clients', () => {
    const { getByLabelText } = render(
      wrap(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />),
    );
    // Open the add form by clicking +Add payment.
    fireEvent.click(screen.getByText('payments.add'));
    expect((getByLabelText('payments.vat_rate') as HTMLInputElement).value).toBe('24');
  });

  it('defaults VAT rate to 0 for Cyprus clients', () => {
    const { getByLabelText } = render(
      wrap(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={0} />),
    );
    fireEvent.click(screen.getByText('payments.add'));
    expect((getByLabelText('payments.vat_rate') as HTMLInputElement).value).toBe('0');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- PaymentsPanel`
Expected: FAIL — `defaultVatRate` prop doesn't exist.

- [ ] **Step 4: Update `PaymentsPanel.tsx`**

Add the prop and use it as the initial value of `newVatRate`:

```tsx
// src/features/deals/PaymentsPanel.tsx
type Props = {
  dealId: string;
  services: PlannedService[];
  defaultVatRate: number;
};

// Inside PaymentsPanel:
const [newVatRate, setNewVatRate] = useState(String(defaultVatRate));

// Also reset it when the form closes:
function submitNew() {
  // ... existing
  setShowAdd(false);
  setNewVatRate(String(defaultVatRate));
  // ...
}
```

Also add `aria-label`s on the existing VAT inputs (`Net (€)`, `VAT %`, `Gross (€)`) so the test selectors work:

```tsx
<Input
  type="number"
  aria-label={t('payments.amount_net')}
  // …
/>
<Input
  type="number"
  aria-label={t('payments.vat_rate')}
  // …
/>
```

- [ ] **Step 5: Update the call-site in `DealDetailPage.tsx`**

Find where `<PaymentsPanel ... />` is rendered. Read `deal.client.country` and convert to a rate:

```tsx
function vatRateForCountry(country: string | null | undefined): number {
  if (country === 'Greece') return 24;
  return 0;
}

// In the render:
<PaymentsPanel
  dealId={deal.id}
  services={services}
  defaultVatRate={vatRateForCountry(deal.client?.country)}
/>
```

If the deal query doesn't already select `client.country`, extend the SELECT in the deal-detail hook to include it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- PaymentsPanel`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/features/deals/PaymentsPanel.tsx src/features/deals/PaymentsPanel.test.tsx src/features/deals/DealDetailPage.tsx
git commit -m "$(cat <<'EOF'
fix(deals): PaymentsPanel new-row VAT defaults to deal's client country

Greek clients default to 24%, Cyprus (and any non-Greek) default
to 0%. Replaces the previous hard-coded "24" default that silently
produced wrong invoices on Cyprus deals.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Bump `amount_net` precision to 4dp + re-backfill to fix VAT round-trip skew

**Severity:** Major — accounting integrity. Visible €0.01 drift on backfilled Greek payments.

**Files:**
- Create: `supabase/migrations/20260601100001_amount_net_precision_4dp.sql`
- Create: `supabase/tests/deal_payments_vat_roundtrip.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/deal_payments_vat_roundtrip.sql
begin;
select plan(1);

-- After the precision bump + re-backfill, every Greek row's gross must
-- round-trip exactly. We confirm by recomputing gross from the stored net
-- and asserting it matches amount (the legacy gross we backfilled from).
select is(
  (select count(*)::int from public.deal_payments
     where amount is not null
       and round(amount_net * (1 + vat_rate / 100), 2) <> amount),
  0,
  'every row round-trips: round(amount_net × (1 + vat_rate/100), 2) = legacy amount'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Confirm the test fails today** (via cloud query)

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"select count(*) from public.deal_payments where amount is not null and round(amount_net * (1 + vat_rate / 100), 2) <> amount"}'
```

Expected: > 0 rows (the rows showing €0.01 drift in the smoke test).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260601100001_amount_net_precision_4dp.sql
-- Widen amount_net so VAT math round-trips exactly.
-- Generated columns must be dropped + recreated when the source column
-- changes type, so we drop them first.
alter table public.deal_payments
  drop column if exists amount_gross,
  drop column if exists vat_amount;

alter table public.deal_payments
  alter column amount_net type numeric(12,4) using amount_net::numeric(12,4);

alter table public.deal_payments
  add column vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- Re-backfill at full precision so gross round-trips to the legacy amount.
-- Cyprus rows stay at amount (they were already exact, no VAT applied).
update public.deal_payments dp
  set amount_net = case
        when dp.vat_rate > 0 then round(dp.amount * 100.0 / (100 + dp.vat_rate), 4)
        else dp.amount
      end
  from public.deals d
  join public.clients c on c.id = d.client_id
  where d.id = dp.deal_id
    and dp.amount is not null;

-- Same treatment for expenses (defensively, even though there's only one row
-- right now). Generated columns must be reset around the precision change.
alter table public.expenses
  drop column if exists amount_gross,
  drop column if exists vat_amount;

alter table public.expenses
  alter column amount_net type numeric(12,4) using amount_net::numeric(12,4);

alter table public.expenses
  add column vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- ROLLBACK:
-- alter table public.deal_payments
--   drop column if exists amount_gross,
--   drop column if exists vat_amount;
-- alter table public.deal_payments
--   alter column amount_net type numeric(12,2) using amount_net::numeric(12,2);
-- alter table public.deal_payments
--   add column vat_amount numeric(12,2)
--     generated always as (round(amount_net * vat_rate / 100, 2)) stored,
--   add column amount_gross numeric(12,2)
--     generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;
-- (repeat the same five statements for public.expenses)
```

- [ ] **Step 4: Push the migration**

```bash
export SUPABASE_ACCESS_TOKEN=<personal access token>
supabase db push
```

Expected: applied without errors.

- [ ] **Step 5: Verify against cloud**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"select count(*) as drift from public.deal_payments where amount is not null and round(amount_net * (1 + vat_rate / 100), 2) <> amount"}'
```

Expected: `[{"drift":0}]`.

- [ ] **Step 6: Regen types**

Run: `npm run types:gen`

The `amount_net` field stays typed as `number` (Postgres `numeric` → JS `number`); only the precision changed.

- [ ] **Step 7: Update the PaymentsPanel display to show net rounded to 2 dp**

The DB column now holds e.g. `241.9355` but the user expects to see `241.94`. Format on display:

```tsx
// In PaymentsPanel.tsx PaymentRow:
const [amountNet, setAmountNet] = useState(
  row.amount_net != null ? row.amount_net.toFixed(2) : '',
);
```

(Round when reading from the row but pass the full-precision number back when writing — write `Number(amountNet)` as before; the DB will keep the user's edited value at 4dp.)

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add supabase/migrations/20260601100001_amount_net_precision_4dp.sql \
        supabase/tests/deal_payments_vat_roundtrip.sql \
        src/types/supabase.ts \
        src/features/deals/PaymentsPanel.tsx
git commit -m "$(cat <<'EOF'
fix(db,deals): bump amount_net to numeric(12,4) + re-backfill at full precision

Previously round(gross / 1.24, 2) produced amount_net values that
recomputed back to gross ± €0.01. Widening to 4dp lets the generated
amount_gross round-trip exactly. UI keeps showing 2dp via toFixed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Translate service-type values in IncomeBreakdown + TransactionDrawer title

**Severity:** Major — UX. Income rows showed raw "hosting" instead of "Hosting & Domains".

**Files:**
- Modify: `src/features/accounting_report/components/IncomeBreakdown.tsx`
- Modify: `src/features/accounting_report/ReportPage.tsx`
- Modify: `src/i18n/locales/en/accounting_report.json` + `el/accounting_report.json` — add `income_breakdown.fallback`

- [ ] **Step 1: Inspect existing service-type translations**

Run: `grep -n '"types"' src/i18n/locales/en/deals.json | head`

The `deals.services.types.*` namespace already has the strings. We just need to use them.

- [ ] **Step 2: Update `IncomeBreakdown.tsx` to translate `category_key`**

```tsx
// src/features/accounting_report/components/IncomeBreakdown.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';

// …existing types…

export function IncomeBreakdown({ rows, onSelectGroup }: IncomeBreakdownProps) {
  const { t } = useTranslation(['accounting_report', 'deals']);
  // …existing useMemo for groups…

  const totalGross = groups.reduce((s, g) => s + g.gross, 0);

  function labelFor(key: string | null): string {
    if (!key) return t('accounting_report:income_breakdown.unknown');
    // deals namespace has services.types.web_seo, .local_seo, .web_dev,
    // .social_media, .ai_seo, .hosting, .ads — fall back to the raw key
    // if a service_type ever leaks through that isn't in the namespace.
    const translated = t(`deals:services.types.${key}`, { defaultValue: key });
    return translated;
  }

  return (
    <section>
      <h3 className="mb-2 font-semibold">{t('accounting_report:income_breakdown.title')}</h3>
      <table className="w-full text-sm">
        {/* …existing head… */}
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.key ?? 'unspecified'}
              className="cursor-pointer hover:bg-neutral-50"
              onClick={() => onSelectGroup(g.key, g.rows, labelFor(g.key))}
            >
              <td className="px-3 py-2">{labelFor(g.key)}</td>
              {/* …rest of cells… */}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

Note the third argument to `onSelectGroup` — the drawer title needs the translated label, not the raw key. Update the type:

```tsx
export type IncomeBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[], title: string) => void;
};
```

- [ ] **Step 3: Mirror the change in `ExpenseBreakdown.tsx`** (it already translates via `labelByKey` from categories — add the same third arg)

```tsx
export type ExpenseBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[], title: string) => void;
  onNewExpense: () => void;
};

// In the row onClick:
onClick={() => onSelectGroup(g.key, g.rows, g.key ? (labelByKey.get(g.key) ?? g.key) : t('expense_breakdown.category'))}
```

- [ ] **Step 4: Update `ReportPage.tsx` to receive the translated title**

```tsx
// Replace the existing openIncomeGroup / openExpenseGroup with:
function openIncomeGroup(_key: string | null, rows: LedgerRow[], title: string) {
  setDrawer({ title, rows });
}
function openExpenseGroup(_key: string | null, rows: LedgerRow[], title: string) {
  setDrawer({ title, rows });
}
```

- [ ] **Step 5: Run the existing test suite**

Run: `npm run test:run -- accounting_report`
Expected: still green (component-level tests don't exercise this code path, but they shouldn't break).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/features/accounting_report/
git commit -m "fix(accounting): translate service types in income breakdown + drawer title

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Translate `billing_type` enum in TransactionDrawer and ExpenseDetailDialog

**Severity:** Major — UX. Drawer column shows raw `recurring_yearly` instead of "Yearly".

**Files:**
- Modify: `src/features/accounting_report/components/TransactionDrawer.tsx`
- Modify: `src/features/accounting_report/components/ExpenseDetailDialog.tsx`

- [ ] **Step 1: Update TransactionDrawer to translate the billing column**

The accounting_report namespace already has `expense_form.one_time / .recurring_monthly / .recurring_yearly`. Reuse them:

```tsx
// src/features/accounting_report/components/TransactionDrawer.tsx
// In the row map:
<td className="px-3 py-2">{t(`expense_form.${r.billing_type}`)}</td>
```

- [ ] **Step 2: Update ExpenseDetailDialog to use translated billing type**

Add a billing type display line in the detail body:

```tsx
// src/features/accounting_report/components/ExpenseDetailDialog.tsx
// After the start/end-date line:
<p className="mt-1 text-sm">
  {t('expense_form.billing_type')}: {t(`expense_form.${e.billing_type}`)}
</p>
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm run test:run -- accounting_report && npm run typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting_report/components/
git commit -m "fix(accounting): translate billing_type enum in drawer + detail dialog

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: TransactionDrawer — backdrop + click-outside to close

**Severity:** Major — UX. Drawer overlays the `+ New expense` button, content underneath isn't clickable.

**Files:**
- Modify: `src/features/accounting_report/components/TransactionDrawer.tsx`

- [ ] **Step 1: Wrap the drawer in a backdrop layer**

```tsx
// src/features/accounting_report/components/TransactionDrawer.tsx
export function TransactionDrawer({
  open, title, rows, onClose, onSelectExpense,
}: TransactionDrawerProps) {
  const { t } = useTranslation('accounting_report');
  if (!open) return null;
  return (
    <>
      {/* Backdrop — covers the page, closes drawer on click. */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer — z-40 sits above the backdrop, stops click propagation so
          clicks inside don't close the drawer. */}
      <div
        className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        {/* …existing body… */}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add an `Escape` key handler to close the drawer**

```tsx
import { useEffect } from 'react';

useEffect(() => {
  if (!open) return;
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [open, onClose]);
```

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`, navigate to `/accounting/report`, switch to "This year", click an income row → drawer opens. Click the backdrop (outside the drawer) → drawer closes. Open drawer again, press Escape → closes.

- [ ] **Step 4: Run tests + commit**

```bash
npm run test:run -- accounting_report && npm run typecheck
git add src/features/accounting_report/components/TransactionDrawer.tsx
git commit -m "fix(accounting): TransactionDrawer backdrop + click-outside-to-close + Escape

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Format `paid_at` as a locale-aware date in ExpenseDetailDialog

**Severity:** Minor — UX. Detail dialog currently shows raw ISO `2026-06-01T12:27:58.551+00:00`.

**Files:**
- Modify: `src/features/accounting_report/components/ExpenseDetailDialog.tsx`

- [ ] **Step 1: Add a small formatter using `Intl.DateTimeFormat`**

```tsx
// At top of ExpenseDetailDialog.tsx, above the component:
function formatPaidAt(iso: string | null, locale: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
```

- [ ] **Step 2: Use it in the status line**

```tsx
// Replace:
//   {e.status === 'paid' && e.paid_at && ` (${e.paid_at})`}
// With:
{e.status === 'paid' && e.paid_at && ` (${formatPaidAt(e.paid_at, i18n.language)})`}
```

- [ ] **Step 3: Run tests + commit**

```bash
npm run test:run -- ExpenseDetailDialog && npm run typecheck
git add src/features/accounting_report/components/ExpenseDetailDialog.tsx
git commit -m "fix(accounting): format expense.paid_at with Intl.DateTimeFormat

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Hide redundant `start_date → end_date` row for one-time expenses

**Severity:** Minor — UX. One-time expenses show "2026-06-01 → 2026-06-01" — the arrow is noise.

**Files:**
- Modify: `src/features/accounting_report/components/ExpenseDetailDialog.tsx`

- [ ] **Step 1: Replace the date line**

```tsx
// Replace:
// <p className="mt-1 text-sm">
//   {t('expense_form.start_date')}: {e.start_date}
//   {e.end_date && ` → ${e.end_date}`}
// </p>
// With:
<p className="mt-1 text-sm">
  {t('expense_form.start_date')}: {e.start_date}
  {e.billing_type !== 'one_time' && e.end_date && e.end_date !== e.start_date && (
    <> → {e.end_date}</>
  )}
</p>
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
git add src/features/accounting_report/components/ExpenseDetailDialog.tsx
git commit -m "fix(accounting): hide redundant date range on one-time expenses

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add "Billing type:" label in NewExpenseDialog above the segmented buttons

**Severity:** Minor — UX. The 3-button group floats unlabelled between Vendor and Net.

**Files:**
- Modify: `src/features/accounting_report/components/NewExpenseDialog.tsx`

- [ ] **Step 1: Wrap the segmented group with a label**

```tsx
// Replace the bare div with:
<div className="mt-3 text-sm">
  <p className="mb-1 text-neutral-700">{t('expense_form.billing_type')}</p>
  <div className="flex gap-2">
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
</div>
```

- [ ] **Step 2: Run NewExpenseDialog tests + commit**

The existing test uses `fireEvent.click(screen.getByText('accounting_report:expense_form.submit'))` — the label addition doesn't change selectors.

```bash
npm run test:run -- NewExpenseDialog
git add src/features/accounting_report/components/NewExpenseDialog.tsx
git commit -m "fix(accounting): NewExpenseDialog billing-type group gets a visible label

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Close ExportMenu on outside-click

**Severity:** Minor — UX.

**Files:**
- Modify: `src/features/accounting_report/components/ExportMenu.tsx`

- [ ] **Step 1: Add a ref + outside-click handler**

```tsx
// src/features/accounting_report/components/ExportMenu.tsx
import { useState, useEffect, useRef } from 'react';
// …

export function ExportMenu({ rangeLabel, from, to, summary, incomeRows, expenseRows }: ExportMenuProps) {
  const { t } = useTranslation('accounting_report');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  // …existing csv / pdf handlers…

  return (
    <div ref={ref} className="relative inline-block">
      {/* …existing button + dropdown… */}
    </div>
  );
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm run test:run -- ExportMenu
git add src/features/accounting_report/components/ExportMenu.tsx
git commit -m "fix(accounting): ExportMenu closes when clicking outside

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Defensive null-guards on `.toFixed(2)` for generated columns

**Severity:** Minor — defensive. The DB constraint prevents nulls today but the regenerated types are nullable.

**Files:**
- Create: `src/features/accounting_report/utils/euro.ts`
- Modify: every component that calls `.toFixed(2)` on `amount_*` / `vat_amount` / `g.gross` etc.

- [ ] **Step 1: Write the helper**

```ts
// src/features/accounting_report/utils/euro.ts
export function euro(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '€—';
  return `€${n.toFixed(2)}`;
}
```

- [ ] **Step 2: Write a small test**

```ts
// src/features/accounting_report/utils/euro.test.ts
import { describe, it, expect } from 'vitest';
import { euro } from './euro';

describe('euro', () => {
  it('formats numbers with two decimals', () => {
    expect(euro(100)).toBe('€100.00');
    expect(euro(0)).toBe('€0.00');
    expect(euro(-50.5)).toBe('€-50.50');
  });
  it('returns €— for null / undefined / NaN', () => {
    expect(euro(null)).toBe('€—');
    expect(euro(undefined)).toBe('€—');
    expect(euro(Number.NaN)).toBe('€—');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- euro`
Expected: PASS (4 of 4).

- [ ] **Step 4: Replace inline `€${x.toFixed(2)}` with `euro(x)` across the feature**

```bash
grep -rln '\.toFixed(2)' src/features/accounting_report/
```

For each file, replace `€${expr.toFixed(2)}` with `{euro(expr)}` and add `import { euro } from '../utils/euro'` (or `'./utils/euro'` from `ReportPage.tsx`/`ExpensesPage.tsx`).

Touch list:
- `src/features/accounting_report/components/ExpenseRow.tsx`
- `src/features/accounting_report/components/IncomeBreakdown.tsx`
- `src/features/accounting_report/components/ExpenseBreakdown.tsx`
- `src/features/accounting_report/components/TransactionDrawer.tsx`
- `src/features/accounting_report/components/ReportHeader.tsx`
- `src/features/accounting_report/components/NewExpenseDialog.tsx` (the live gross preview)
- `src/features/accounting_report/components/ExpenseDetailDialog.tsx`
- `src/features/accounting_report/ExpensesPage.tsx`

- [ ] **Step 5: Run tests + typecheck + commit**

```bash
npm run test:run -- accounting_report && npm run typecheck
git add src/features/accounting_report/
git commit -m "fix(accounting): null-safe euro() helper replaces inline .toFixed(2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Fix the 8 pre-existing `set-state-in-effect` lint errors in OfferBuilderPage

**Severity:** Process — gating lint in CI requires this clean first.

**Files:**
- Modify: `src/features/offers/OfferBuilderPage.tsx`

- [ ] **Step 1: Read the affected effect blocks**

Run: `npm run lint 2>&1 | grep OfferBuilderPage`

The pattern: an effect that runs once when `lead` becomes available and calls `setX(...)` several times. Each `setX` is a `set-state-in-effect` flag.

- [ ] **Step 2: Refactor — derive state with `useMemo` where possible**

For the "client name override" block (around line 104):

```tsx
// Before:
useEffect(() => {
  if (!lead) return;
  const name = lead.contact_full_name || lead.company_name || '';
  if (name) setClientNameOverride(name);
  if (lead.email) setEmailOverride(lead.email);
  // …
}, [lead]);

// After: use lazy state initialiser + a ref to ensure we only seed once
// per lead change, never during render.
const seededLeadRef = useRef<string | null>(null);
useEffect(() => {
  if (!lead || seededLeadRef.current === lead.id) return;
  seededLeadRef.current = lead.id;
  const name = lead.contact_full_name || lead.company_name || '';
  if (name) setClientNameOverride(name);
  if (lead.email) setEmailOverride(lead.email);
  // …keep the rest unchanged…
}, [lead]);
```

The lint rule fires because *unconditional* `setState` in an effect is what triggers cascading renders. Gating the body with a ref converts the pattern into "subscribe + react to lead-id changes" which is the intended use.

Apply the same pattern to the second effect (around line 180) — guard with the ref so the body runs at most once per `lead.id` change.

> **Note:** If the test suite covers OfferBuilderPage behaviour, run those tests after the refactor to confirm no regression. If there are no tests, manually verify by opening `/leads/<some lead>/offers/new` and confirming the client name / email / item selection seed exactly once.

- [ ] **Step 3: Run lint + tests**

```bash
npm run lint
npm run test:run
```

Expected: 0 lint errors / warnings; full test suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/features/offers/OfferBuilderPage.tsx
git commit -m "fix(offers): refactor OfferBuilder effects to satisfy set-state-in-effect lint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Gate Vercel builds on lint as well as typecheck

**Severity:** Process — without this, future `set-state-in-effect` violations slip through.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the `build` script**

Current: `"build": "tsc -b && vite build"`. New:

```json
"build": "tsc -b && npm run lint && vite build",
```

(Run `cat package.json | python3 -c "import json,sys;print(json.load(sys.stdin)['scripts']['build'])"` first to confirm the current value before editing.)

- [ ] **Step 2: Verify locally**

```bash
npm run build
```

Expected: passes after Task 11 lands. If it fails, fix the underlying issue rather than backing out the lint step.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: gate vercel build on lint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: i18n the sidebar section headers (`Sales` / `Accounting` / `Technical`)

**Severity:** Process — small UX polish.

**Files:**
- Modify: `src/i18n/locales/en/common.json`
- Modify: `src/i18n/locales/el/common.json`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add the keys**

```json
// src/i18n/locales/en/common.json — extend "nav" section
"nav": {
  // …existing keys…
  "section": {
    "sales": "Sales",
    "accounting": "Accounting",
    "technical": "Technical"
  }
}
```

```json
// src/i18n/locales/el/common.json
"nav": {
  // …existing keys…
  "section": {
    "sales": "Πωλήσεις",
    "accounting": "Λογιστήριο",
    "technical": "Τεχνικό"
  }
}
```

- [ ] **Step 2: Use the keys in Sidebar.tsx**

Replace the three hard-coded `<p>Sales</p>` / `<p>Accounting</p>` / `<p>Technical</p>` headers with `{t('common:nav.section.sales')}` etc. (or `{t('nav.section.sales')}` if `common` is the default namespace).

- [ ] **Step 3: Run dev + verify**

```bash
npm run dev
```

Toggle the language picker: English shows "Sales / Accounting / Technical", Greek shows "Πωλήσεις / Λογιστήριο / Τεχνικό".

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/common.json src/i18n/locales/el/common.json src/components/layout/Sidebar.tsx
git commit -m "i18n: translate sidebar section headers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Manual UAT + token rotation

**Severity:** Process — non-code finale.

This task is a checklist, not a code edit.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Smoke through every fixed surface**

1. `/accounting/report` → "This year" preset → click the hosting income row → drawer title reads **"Hosting & Domains"** (EN) or **"Φιλοξενία & Domains"** (EL).
2. Drawer table shows **Yearly / Monthly / One-time** in the Billing column.
3. Click the backdrop → drawer closes. Reopen and press Escape → closes.
4. Click `+ New expense` while no drawer is open. Confirm the segmented buttons sit under a "Billing type" label. Submit a one-time expense with "Save & mark paid" → expense detail dialog shows `paid_at` as `1 Jun 2026, 12:30` (or similar, locale-formatted), no `→` after `Start date` when end = start.
5. Open a Greek deal → Payment tab → click `+ Add payment` → VAT % defaults to **24**. Open a Cyprus deal → `+ Add payment` → VAT % defaults to **0**.
6. Switch the UI to Greek (header language picker) → sidebar shows **Πωλήσεις / Λογιστήριο / Τεχνικό** section headers.
7. Open Export menu, click anywhere outside it → menu closes.
8. Run `npm run build` → finishes without lint errors.

- [ ] **Step 3: Rotate the Supabase access token**

Open https://supabase.com/dashboard/account/tokens → revoke `sbp_ec1f…` (the token used during the 2026-06-01 deployment session) → generate a new one if you need cloud-CLI access again. Do not paste the new token into any chat.

- [ ] **Step 4: Push the entire branch and confirm Vercel deploys clean**

```bash
git push origin main
```

Watch the Vercel build log: typecheck + lint + vite build must all succeed.

---

## Self-Review

**1. Spec coverage** — the "spec" here is the 15-bug list. Mapping:

- Bug 1 (rounding skew) → Task 2 ✓
- Bug 2 (new-row VAT default) → Task 1 ✓
- Bug 3 (untranslated service types) → Task 3 ✓
- Bug 4 (untranslated billing_type) → Task 4 ✓
- Bug 5 (drawer overlay traps clicks) → Task 5 ✓
- Bug 6 (raw ISO paid_at) → Task 6 ✓
- Bug 7 (redundant one-time date range) → Task 7 ✓
- Bug 8 (missing billing-type label) → Task 8 ✓
- Bug 9 (ExportMenu outside-click) → Task 9 ✓
- Bug 10 (.toFixed null guards) → Task 10 ✓
- Bug 11 (pre-existing lint errors) → Task 11 ✓
- Bug 12 (lint not gating build) → Task 12 ✓
- Bug 13 (sidebar headers) → Task 13 ✓
- Bug 14 (token leak) → Task 14 step 3 ✓
- Bug 15 (open spec questions) → **deliberately deferred** — they require operational data we don't have yet (a full month of real use to decide `deal_payments` vs `monthly_invoices` canonical source; that decision drives the legacy `amount` column drop).

No gaps.

**2. Placeholder scan** — no TBD / TODO / "implement later" anywhere. The `> **Note:**` aside in Task 11 documents an honest verification limitation (tests may not exist for the OfferBuilder effect), not a placeholder.

**3. Type consistency**
- `defaultVatRate: number` consistently on Task 1.
- `onSelectGroup(key, rows, title)` signature consistent across Task 3's IncomeBreakdown + ExpenseBreakdown + ReportPage update.
- `euro()` helper signature `(n: number | null | undefined) => string` consistent across Task 10's many touch-points.
- i18n keys `common:nav.section.sales` etc. consistent across both locale files and Sidebar.tsx in Task 13.

All checks pass.
