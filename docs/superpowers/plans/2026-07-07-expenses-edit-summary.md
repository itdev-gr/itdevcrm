# Expenses Edit + Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit any expense from its detail dialog, and show a filtered-totals summary bar + month picker on `/accounting/expenses`.

**Architecture:** Frontend-only. A new `ExpenseEditForm` rendered inside `ExpenseDetailDialog` wires the existing (unused) `useUpdateExpense` hook. A new `ExpensesSummaryBar` computes totals client-side from the already-fetched filtered rows; a month `<select>` in the filter bar maps to the hook's existing `from`/`to` filters via a small pure util.

**Tech Stack:** React 18 + TypeScript, @tanstack/react-query, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-07-expenses-edit-summary-design.md`

## Global Constraints

- Verify with `npm run build` (tsc -b strict + eslint --max-warnings=0). Index into mock-call arrays with `!`.
- Tests fully mock `@/lib/supabase` / feature hooks — the vitest suite runs against prod config; no network in tests.
- `NewExpenseDialog.tsx` must NOT be modified (protects the autopay tests).
- Edit never writes `status`, `paid_at`, `paid_by`, `autopay`, `receipt_path`.
- Both locales (`src/i18n/locales/{en,el}/accounting_report.json`) updated together; keys `expense_form.edit_title` ("Edit expense"/"Επεξεργασία εξόδου"), `expense_form.submit` ("Save"), `expense_form.cancel` already exist — reuse them.
- No DB changes. Push to main only in the final task after a live smoke.

---

### Task 1: ExpenseEditForm component

**Files:**
- Create: `src/features/accounting_report/components/ExpenseEditForm.tsx`
- Test: `src/features/accounting_report/components/ExpenseEditForm.test.tsx`
- Modify: `src/i18n/locales/en/accounting_report.json`, `src/i18n/locales/el/accounting_report.json`

**Interfaces:**
- Consumes: `useUpdateExpense` (`../hooks/useUpdateExpense`, `mutateAsync({ id, patch: UpdateExpensePatch })` — patch keys: `vendor, categoryId, billingType, amountNet, vatRate, startDate, endDate, notes, paymentMethod`); `useExpenseCategories`; `ExpenseListRow` type from `../hooks/useExpenses`.
- Produces: `ExpenseEditForm({ expense, onDone }: { expense: ExpenseListRow; onDone: () => void })` — Task 2 renders it inside the detail dialog. `onDone` fires on both successful save and cancel.

- [ ] **Step 1: Add i18n keys**

In `src/i18n/locales/en/accounting_report.json`, inside `expense_form` add:
```json
"edit_chain_hint": "Future periods copy the newest row of this expense — edit the latest one to change upcoming amounts."
```
In `expense_detail` add: `"edit": "Edit"`.

In `src/i18n/locales/el/accounting_report.json`, inside `expense_form` add:
```json
"edit_chain_hint": "Οι επόμενες περίοδοι αντιγράφουν την πιο πρόσφατη εγγραφή αυτού του εξόδου — επεξεργαστείτε την τελευταία για να αλλάξετε τα επόμενα ποσά."
```
In `expense_detail` add: `"edit": "Επεξεργασία"`.

- [ ] **Step 2: Write the failing tests**

Create `src/features/accounting_report/components/ExpenseEditForm.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { updateMutateAsync } = vi.hoisted(() => ({ updateMutateAsync: vi.fn() }));

vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    data: [
      { id: 'cat-1', name_en: 'Software', name_el: 'Λογισμικό' },
      { id: 'cat-2', name_en: 'Rent', name_el: 'Ενοίκιο' },
    ],
  }),
}));
vi.mock('../hooks/useUpdateExpense', () => ({
  useUpdateExpense: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

import { ExpenseEditForm } from './ExpenseEditForm';
import type { ExpenseListRow } from '../hooks/useExpenses';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function expense(overrides: Partial<ExpenseListRow> = {}): ExpenseListRow {
  return {
    id: 'e1',
    category_id: 'cat-1',
    vendor: 'COSMOTE',
    billing_type: 'recurring_monthly',
    amount_net: 99.8,
    vat_rate: 0,
    vat_amount: 0,
    amount_gross: 99.8,
    start_date: '2026-07-01',
    end_date: '2026-08-01',
    status: 'pending',
    payment_method: 'CARD',
    paid_at: null,
    paid_by: null,
    notes: null,
    receipt_path: null,
    parent_expense_id: null,
    autopay: false,
    created_by: null,
    created_at: '2026-07-07T00:00:00Z',
    category: { key: 'software', name_en: 'Software', name_el: 'Λογισμικό' },
    ...overrides,
  };
}

describe('ExpenseEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('prefills all fields from the expense', () => {
    render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat-1');
    expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('COSMOTE');
    expect((screen.getByLabelText('Amount (net)') as HTMLInputElement).value).toBe('99.8');
    expect((screen.getByLabelText('VAT rate (%)') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-07-01');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-08-01');
    expect((screen.getByLabelText('Payment method') as HTMLInputElement).value).toBe('CARD');
  });

  it('saves the edited fields via useUpdateExpense and calls onDone', async () => {
    const onDone = vi.fn();
    render(wrap(<ExpenseEditForm expense={expense()} onDone={onDone} />));
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'COSMOTE SA' } });
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Save' });

    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      patch: {
        vendor: 'COSMOTE SA',
        categoryId: 'cat-1',
        billingType: 'recurring_monthly',
        amountNet: 120,
        vatRate: 0,
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        notes: null,
        paymentMethod: 'CARD',
      },
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('blocks save when amount is emptied', () => {
    render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Net amount is required.')).toBeTruthy();
  });

  it('blocks save when end date is before start date', () => {
    render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('End date must be on or after start date.')).toBeTruthy();
  });

  it('shows the chain hint for recurring expenses only', () => {
    const { unmount } = render(wrap(<ExpenseEditForm expense={expense()} onDone={() => {}} />));
    expect(screen.getByText(/Future periods copy the newest row/)).toBeTruthy();
    unmount();
    render(wrap(<ExpenseEditForm expense={expense({ billing_type: 'one_time' })} onDone={() => {}} />));
    expect(screen.queryByText(/Future periods copy the newest row/)).toBeNull();
  });

  it('cancel calls onDone without saving', () => {
    const onDone = vi.fn();
    render(wrap(<ExpenseEditForm expense={expense()} onDone={onDone} />));
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/accounting_report/components/ExpenseEditForm.test.tsx`
Expected: FAIL — cannot resolve `./ExpenseEditForm`.

- [ ] **Step 4: Implement the component**

Create `src/features/accounting_report/components/ExpenseEditForm.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseCategories } from '../hooks/useExpenseCategories';
import { useUpdateExpense } from '../hooks/useUpdateExpense';
import type { ExpenseListRow } from '../hooks/useExpenses';

type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';

export type ExpenseEditFormProps = {
  expense: ExpenseListRow;
  onDone: () => void;
};

export function ExpenseEditForm({ expense, onDone }: ExpenseEditFormProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const update = useUpdateExpense();
  const isEl = i18n.language.startsWith('el');

  const [categoryId, setCategoryId] = useState(expense.category_id);
  const [vendor, setVendor] = useState(expense.vendor ?? '');
  const [billingType, setBillingType] = useState<BillingType>(expense.billing_type);
  const [amountNet, setAmountNet] = useState(String(expense.amount_net));
  const [vatRate, setVatRate] = useState(String(expense.vat_rate));
  const [startDate, setStartDate] = useState(expense.start_date);
  const [endDate, setEndDate] = useState(expense.end_date ?? '');
  const [paymentMethod, setPaymentMethod] = useState(expense.payment_method ?? '');
  const [notes, setNotes] = useState(expense.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!categoryId) return setError(t('expense_form.validation.category_required'));
    if (!amountNet) return setError(t('expense_form.validation.amount_required'));
    if (!startDate) return setError(t('expense_form.validation.start_date_required'));
    if (endDate && endDate < startDate)
      return setError(t('expense_form.validation.end_date_after_start'));
    try {
      await update.mutateAsync({
        id: expense.id,
        patch: {
          vendor: vendor || null,
          categoryId,
          billingType,
          amountNet: Number(amountNet),
          vatRate: Number(vatRate),
          startDate,
          endDate: endDate || null,
          notes: notes || null,
          paymentMethod: paymentMethod || null,
        },
      });
      onDone();
    } catch {
      setError(t('errors.save_failed'));
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{t('expense_form.edit_title')}</h3>

      <label className="block text-sm">
        {t('expense_form.category')}
        <select
          aria-label={t('expense_form.category')}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
        >
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

      <div className="mt-3 text-sm">
        <p className="mb-1 text-muted-foreground">{t('expense_form.billing_type')}</p>
        <div className="flex gap-2">
          {(['one_time','recurring_monthly','recurring_yearly'] as BillingType[]).map((bt) => (
            <button
              key={bt}
              type="button"
              onClick={() => setBillingType(bt)}
              className={`rounded border px-2 py-1 ${billingType === bt ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {t(`expense_form.${bt}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
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
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <label>
          {t('expense_form.start_date')}
          <input
            aria-label={t('expense_form.start_date')}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
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

      {billingType !== 'one_time' && (
        <p className="mt-2 text-xs text-muted-foreground">{t('expense_form.edit_chain_hint')}</p>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onDone}>
          {t('expense_form.cancel')}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={save}
          disabled={update.isPending}
        >
          {t('expense_form.submit')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/accounting_report/components/ExpenseEditForm.test.tsx`
Expected: 6/6 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/accounting_report/components/ExpenseEditForm.tsx \
        src/features/accounting_report/components/ExpenseEditForm.test.tsx \
        src/i18n/locales/en/accounting_report.json \
        src/i18n/locales/el/accounting_report.json
git commit -m "feat(expenses): expense edit form component"
```

---

### Task 2: Edit mode in ExpenseDetailDialog

**Files:**
- Modify: `src/features/accounting_report/components/ExpenseDetailDialog.tsx`
- Test: `src/features/accounting_report/components/ExpenseDetailDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `ExpenseEditForm({ expense, onDone })` from Task 1; i18n key `expense_detail.edit` from Task 1.
- Produces: detail dialog with an Edit button that swaps the read-only body for the edit form; exiting edit (save or cancel) returns to the read-only view.

- [ ] **Step 1: Write the failing tests (append to the existing Autopay describe's file)**

Append to `src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`. First add this mock next to the other `vi.mock` calls at the top (the edit form itself is tested in its own file):

```tsx
vi.mock('./ExpenseEditForm', () => ({
  ExpenseEditForm: ({ onDone }: { onDone: () => void }) => (
    <div>
      <p>EDIT_FORM_STUB</p>
      <button type="button" onClick={onDone}>stub-done</button>
    </div>
  ),
}));
```

Then append the new describe block:

```tsx
describe('ExpenseDetailDialog — Edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an Edit button and swaps to the edit form', () => {
    detailData.current = baseExpense();
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    expect(screen.queryByText('EDIT_FORM_STUB')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('EDIT_FORM_STUB')).toBeTruthy();
    // read-only actions hidden while editing
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('returns to the read-only view when the form signals done', () => {
    detailData.current = baseExpense();
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'stub-done' }));
    expect(screen.queryByText('EDIT_FORM_STUB')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`
Expected: existing tests PASS; the 2 new ones FAIL (no Edit button).

- [ ] **Step 3: Implement**

In `src/features/accounting_report/components/ExpenseDetailDialog.tsx`:

Add imports:
```tsx
import { useEffect } from 'react'; // merge into the existing react import: { useEffect, useState }
import { ExpenseEditForm } from './ExpenseEditForm';
```

Add state next to the other useState calls, and reset it when the target row changes:
```tsx
const [editing, setEditing] = useState(false);
useEffect(() => setEditing(false), [id]);
```

Wrap the existing read-only body: inside the `{detail.isLoading || !e ? … : (<>…</>)}` else-branch, replace the fragment `<>…</>` with:

```tsx
editing ? (
  <ExpenseEditForm expense={e} onDone={() => setEditing(false)} />
) : (
  <> …existing read-only body unchanged… </>
)
```

Add the Edit button in the footer row, next to Delete (inside the existing `mt-6 flex justify-between` div, left group becomes a flex with two buttons):

```tsx
<div className="flex gap-2">
  <button type="button" onClick={onDelete} className="rounded border px-3 py-1.5 text-sm text-red-600 dark:text-red-400">
    {t('expense_detail.delete')}
  </button>
  <button type="button" onClick={() => setEditing(true)} className="rounded border px-3 py-1.5 text-sm">
    {t('expense_detail.edit')}
  </button>
</div>
```

(The footer stays only in the read-only branch — the edit form has its own Save/Cancel.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`
Expected: ALL PASS (old autopay tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/components/ExpenseDetailDialog.tsx \
        src/features/accounting_report/components/ExpenseDetailDialog.test.tsx
git commit -m "feat(expenses): edit mode in the expense detail dialog"
```

---

### Task 3: Summary bar + month picker

**Files:**
- Create: `src/features/accounting_report/utils/monthFilter.ts`
- Create: `src/features/accounting_report/components/ExpensesSummaryBar.tsx`
- Test: `src/features/accounting_report/utils/monthFilter.test.ts`
- Test: `src/features/accounting_report/components/ExpensesSummaryBar.test.tsx`
- Modify: `src/features/accounting_report/ExpensesPage.tsx`
- Modify: `src/i18n/locales/en/accounting_report.json`, `src/i18n/locales/el/accounting_report.json`

**Interfaces:**
- Consumes: `ExpenseListRow` from `../hooks/useExpenses`; `useExpenses` already supports `from`/`to` (gte/lte on `start_date`).
- Produces: `monthOptions(now: Date): { value: string; label: string }[]` (24 entries, `value` = `YYYY-MM`, newest first); `monthRange(value: string): { from: string; to: string }` (first/last day of the month); `ExpensesSummaryBar({ rows }: { rows: ExpenseListRow[] })`.

- [ ] **Step 1: Add i18n keys**

en `expenses_list`: `"month_all": "All time"`. el `expenses_list`: `"month_all": "Όλες οι περίοδοι"`.

- [ ] **Step 2: Write the failing util tests**

Create `src/features/accounting_report/utils/monthFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { monthOptions, monthRange } from './monthFilter';

describe('monthFilter', () => {
  it('produces 24 months, newest first, from the given date', () => {
    const opts = monthOptions(new Date('2026-07-15T00:00:00Z'));
    expect(opts).toHaveLength(24);
    expect(opts[0]!.value).toBe('2026-07');
    expect(opts[1]!.value).toBe('2026-06');
    expect(opts[23]!.value).toBe('2024-08');
  });

  it('monthRange returns first and last day of the month', () => {
    expect(monthRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});
```

- [ ] **Step 3: Run util tests to verify they fail**

Run: `npx vitest run src/features/accounting_report/utils/monthFilter.test.ts`
Expected: FAIL — cannot resolve `./monthFilter`.

- [ ] **Step 4: Implement the util**

Create `src/features/accounting_report/utils/monthFilter.ts`:

```ts
export function monthOptions(now: Date): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(y, m - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: value });
  }
  return out;
}

export function monthRange(value: string): { from: string; to: string } {
  const [y, m] = value.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // day 0 of next month
  return {
    from: `${value}-01`,
    to: `${value}-${String(lastDay).padStart(2, '0')}`,
  };
}
```

- [ ] **Step 5: Run util tests to verify they pass**

Run: `npx vitest run src/features/accounting_report/utils/monthFilter.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 6: Write the failing summary-bar tests**

Create `src/features/accounting_report/components/ExpensesSummaryBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { ExpensesSummaryBar } from './ExpensesSummaryBar';
import type { ExpenseListRow } from '../hooks/useExpenses';

function row(overrides: Partial<ExpenseListRow>): ExpenseListRow {
  return {
    id: Math.random().toString(36).slice(2),
    category_id: 'cat-1',
    vendor: 'V',
    billing_type: 'one_time',
    amount_net: 0,
    vat_rate: 0,
    vat_amount: 0,
    amount_gross: 0,
    start_date: '2026-07-01',
    end_date: null,
    status: 'pending',
    payment_method: null,
    paid_at: null,
    paid_by: null,
    notes: null,
    receipt_path: null,
    parent_expense_id: null,
    autopay: false,
    created_by: null,
    created_at: '2026-07-07T00:00:00Z',
    category: null,
    ...overrides,
  };
}

describe('ExpensesSummaryBar', () => {
  it('sums net, vat, gross and splits pending vs paid', () => {
    const rows = [
      row({ amount_net: 100, vat_amount: 24, amount_gross: 124, status: 'pending' }),
      row({ amount_net: 50, vat_amount: 12, amount_gross: 62, status: 'paid' }),
      row({ amount_net: 50, vat_amount: 0, amount_gross: 50, status: 'paid' }),
    ];
    render(<ExpensesSummaryBar rows={rows} />);
    expect(screen.getByTestId('summary-count').textContent).toBe('3');
    expect(screen.getByTestId('summary-net').textContent).toBe('€200.00');
    expect(screen.getByTestId('summary-vat').textContent).toBe('€36.00');
    expect(screen.getByTestId('summary-gross').textContent).toBe('€236.00');
    expect(screen.getByTestId('summary-pending').textContent).toBe('€124.00');
    expect(screen.getByTestId('summary-paid').textContent).toBe('€112.00');
  });

  it('renders zeros for an empty list', () => {
    render(<ExpensesSummaryBar rows={[]} />);
    expect(screen.getByTestId('summary-count').textContent).toBe('0');
    expect(screen.getByTestId('summary-gross').textContent).toBe('€0.00');
  });
});
```

- [ ] **Step 7: Run to verify they fail**

Run: `npx vitest run src/features/accounting_report/components/ExpensesSummaryBar.test.tsx`
Expected: FAIL — cannot resolve `./ExpensesSummaryBar`.

- [ ] **Step 8: Implement the summary bar**

Create `src/features/accounting_report/components/ExpensesSummaryBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { ExpenseListRow } from '../hooks/useExpenses';

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

export function ExpensesSummaryBar({ rows }: { rows: ExpenseListRow[] }) {
  const { t } = useTranslation('accounting_report');
  let net = 0, vat = 0, gross = 0, pending = 0, paid = 0;
  for (const r of rows) {
    net += r.amount_net;
    vat += r.vat_amount;
    gross += r.amount_gross;
    if (r.status === 'paid') paid += r.amount_gross;
    else pending += r.amount_gross;
  }

  const cell = 'flex items-baseline gap-1.5';
  const label = 'text-[11px] uppercase tracking-wide text-muted-foreground';
  const value = 'text-sm font-semibold tabular-nums';

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm shadow-sm">
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.count')}</span>
        <span className={value} data-testid="summary-count">{rows.length}</span>
      </div>
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.net')}</span>
        <span className={value} data-testid="summary-net">{eur(net)}</span>
      </div>
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.vat')}</span>
        <span className={value} data-testid="summary-vat">{eur(vat)}</span>
      </div>
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.gross')}</span>
        <span className={value} data-testid="summary-gross">{eur(gross)}</span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <div className={cell}>
          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{t('status.pending')}</span>
          <span className={value} data-testid="summary-pending">{eur(pending)}</span>
        </div>
        <div className={cell}>
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{t('status.paid')}</span>
          <span className={value} data-testid="summary-paid">{eur(paid)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Wire both into ExpensesPage**

In `src/features/accounting_report/ExpensesPage.tsx`:

Add imports:
```tsx
import { ExpensesSummaryBar } from './components/ExpensesSummaryBar';
import { monthOptions, monthRange } from './utils/monthFilter';
```

Add state + derived range (next to the other filter state):
```tsx
const [month, setMonth] = useState('');
const months = monthOptions(new Date());
const range = month ? monthRange(month) : null;
```

Extend the `useExpenses` call:
```tsx
const expenses = useExpenses({
  ...(status !== 'all' ? { status } : {}),
  ...(categoryId ? { categoryId } : {}),
  ...(vendor ? { vendor } : {}),
  ...(range ? { from: range.from, to: range.to } : {}),
});
```

Add the month select in the FilterBar, right after the category `FilterSelect`:
```tsx
<FilterSelect
  aria-label={t('expenses_list.month_all')}
  value={month}
  onChange={(e) => setMonth(e.target.value)}
  className="min-w-[140px]"
>
  <option value="">{t('expenses_list.month_all')}</option>
  {months.map((m) => (
    <option key={m.value} value={m.value}>{m.label}</option>
  ))}
</FilterSelect>
```

Render the summary bar between the `</FilterBar>` close and the table container div:
```tsx
<ExpensesSummaryBar rows={rows} />
```

- [ ] **Step 10: Run the whole feature directory + verify**

Run: `npx vitest run src/features/accounting_report/`
Expected: ALL PASS.

- [ ] **Step 11: Commit**

```bash
git add src/features/accounting_report/utils/monthFilter.ts \
        src/features/accounting_report/utils/monthFilter.test.ts \
        src/features/accounting_report/components/ExpensesSummaryBar.tsx \
        src/features/accounting_report/components/ExpensesSummaryBar.test.tsx \
        src/features/accounting_report/ExpensesPage.tsx \
        src/i18n/locales/en/accounting_report.json \
        src/i18n/locales/el/accounting_report.json
git commit -m "feat(expenses): summary totals bar + month filter"
```

---

### Task 4: Verify, deploy, live smoke (main session)

- [ ] **Step 1:** `npx vitest run src/features/accounting_report/` → all PASS; `npm run build` → clean.
- [ ] **Step 2:** Push to main (frontend-only; no DB gate).
- [ ] **Step 3:** Live smoke: edit a real expense's vendor and revert it; check the summary numbers against `select count(*), sum(amount_net), sum(amount_gross) from expenses;` and a month-filtered variant.
- [ ] **Step 4:** Report.
