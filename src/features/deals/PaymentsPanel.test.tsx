import { render, fireEvent, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { DealPaymentRow } from './hooks/useDealPayments';

// t=(k)=>k keeps assertions independent of the i18n catalog.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const updateSpy = vi.fn().mockResolvedValue(undefined);
const deleteSpy = vi.fn().mockResolvedValue(undefined);
const bulkSpy = vi.fn().mockResolvedValue(undefined);

// Flat mock of the data hooks so the update mutation is a spy and no supabase
// client is touched.
vi.mock('./hooks/useDealPayments', () => ({
  dealPaymentsKey: (dealId: string) => ['deal-payments', dealId],
  useDealPayments: () => ({ data: [paymentRow.value], isLoading: false }),
  useUpdateDealPayment: () => ({ mutateAsync: updateSpy, isPending: false }),
  useAddDealPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealPayment: () => ({ mutateAsync: deleteSpy, isPending: false }),
  useBulkMarkDealPaymentsPaid: () => ({ mutateAsync: bulkSpy, isPending: false }),
}));

// useJobsBilling is a react-query hook; stub it so the panel still renders
// without a QueryClientProvider. `billingJobs.value` is what each test uses to
// decide whether the deleted period would be regenerated.
const { billingJobs, paymentRow } = vi.hoisted(() => ({
  billingJobs: { value: [] as unknown[] },
  paymentRow: { value: null as unknown as DealPaymentRow },
}));
vi.mock('./hooks/useJobsBilling', () => ({
  useJobsBilling: () => ({ data: { jobs: billingJobs.value, payments: [] } }),
}));

import { PaymentsPanel } from './PaymentsPanel';

const row: DealPaymentRow = {
  id: 'p1',
  deal_id: 'd1',
  amount_gross: 124,
  amount_net: 100,
  billing_type: 'one_time',
  created_at: '2026-07-01T00:00:00Z',
  end_date: null,
  invoice_number: null,
  label: 'First',
  paid_at: null,
  service_index: 0,
  service_type: 'web_dev',
  start_date: '2026-07-01',
  status: 'pending',
  updated_at: '2026-07-01T00:00:00Z',
  vat_amount: 24,
  vat_rate: 24,
};

function dateInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="date"]'));
}

// A settled month that has passed lives inside the collapsed Past payments
// archive: open the archive, then expand the month, to reach its rows.
function openPastMonth() {
  fireEvent.click(screen.getByText('payments.past_title'));
  fireEvent.click(screen.getByLabelText('payments.toggle_month'));
}

beforeEach(() => {
  paymentRow.value = row;
  billingJobs.value = [];
});

describe('PaymentsPanel start/end date cells', () => {
  beforeEach(() => updateSpy.mockClear());

  it('does not commit on change, commits once on blur with the final value', () => {
    const { container } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    const start = dateInputs(container)[0]!;

    // Simulate the intermediate valid dates a native date input emits while the
    // user types the year digit-by-digit — none of these may hit the DB.
    fireEvent.change(start, { target: { value: '0002-09-15' } });
    fireEvent.change(start, { target: { value: '0202-09-15' } });
    fireEvent.change(start, { target: { value: '2026-09-15' } });
    expect(updateSpy).not.toHaveBeenCalled();

    fireEvent.blur(start);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      id: 'p1',
      patch: { start_date: '2026-09-15' },
    });
  });

  it('does not commit on blur when the start date is unchanged (equality guard)', () => {
    const { container } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    const start = dateInputs(container)[0]!;

    fireEvent.blur(start);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('commits the end date once on blur, not on change', () => {
    const { container } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    const end = dateInputs(container)[1]!;

    fireEvent.change(end, { target: { value: '2026-12-31' } });
    expect(updateSpy).not.toHaveBeenCalled();

    fireEvent.blur(end);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      id: 'p1',
      patch: { end_date: '2026-12-31' },
    });
  });
});

/**
 * Deleting a period does not stop the billing — ensure_recurring_payments()
 * keys off jobs.billing_active, not the payment rows, so a recurring chain whose
 * job is still switched on regenerates the period the user just removed. The
 * dialog has to say that, and has to name the control that does stop it.
 */
describe('PaymentsPanel delete confirmation', () => {
  const recurringRow: DealPaymentRow = {
    ...row,
    billing_type: 'recurring_monthly',
    service_type: 'local_seo',
    end_date: '2026-08-01',
  };
  const liveLocalSeoJob = {
    department: 'local_seo',
    billing_type: 'recurring_monthly',
    billing_active: true,
  };

  beforeEach(() => deleteSpy.mockClear());

  it('asks before deleting instead of removing the row outright', () => {
    const { getByLabelText, queryByText } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    expect(queryByText('payments.remove_confirm_title')).not.toBeInTheDocument();

    fireEvent.click(getByLabelText('payments.remove_row'));

    expect(queryByText('payments.remove_confirm_title')).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('deletes once the dialog is confirmed', () => {
    const { getByLabelText, getByText } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    fireEvent.click(getByLabelText('payments.remove_row'));
    fireEvent.click(getByText('payments.remove'));

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('p1');
  });

  it('warns that the period comes back while the service is still billing', () => {
    paymentRow.value = recurringRow;
    billingJobs.value = [liveLocalSeoJob];

    const { getByLabelText, queryByText } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    fireEvent.click(getByLabelText('payments.remove_row'));

    expect(queryByText('payments.remove_confirm_regenerates')).toBeInTheDocument();
    expect(queryByText('payments.remove_confirm_plain')).not.toBeInTheDocument();
  });

  it('does not warn when billing for that service is already switched off', () => {
    paymentRow.value = recurringRow;
    billingJobs.value = [{ ...liveLocalSeoJob, billing_active: false }];

    const { getByLabelText, queryByText } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    fireEvent.click(getByLabelText('payments.remove_row'));

    expect(queryByText('payments.remove_confirm_plain')).toBeInTheDocument();
    expect(queryByText('payments.remove_confirm_regenerates')).not.toBeInTheDocument();
  });

  it('does not warn for a one-time period, which the generator never recreates', () => {
    // A live recurring local_seo job exists, but this row is the one_time
    // web_dev period — a different chain, so it must not borrow the warning.
    billingJobs.value = [liveLocalSeoJob];

    const { getByLabelText, queryByText } = render(
      <PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />,
    );
    fireEvent.click(getByLabelText('payments.remove_row'));

    expect(queryByText('payments.remove_confirm_plain')).toBeInTheDocument();
  });
});

/**
 * Marking a row paid must never blindly stamp "now" — the DB guard
 * (money_paid_needs_date) requires a real, non-future paid_at, so the UI has
 * to ask for the date instead of assuming it.
 */
describe('PaymentsPanel mark paid asks for a real payment date', () => {
  beforeEach(() => updateSpy.mockClear());

  it('opens a date popover instead of marking paid immediately', () => {
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);

    fireEvent.click(screen.getByText('payments.status_pending'));

    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('payments.paid_date_label')).toBeInTheDocument();
  });

  it('defaults the popover date to today and submits it as paid_at at midnight UTC', () => {
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    fireEvent.click(screen.getByText('payments.status_pending'));

    const dateInput = screen.getByLabelText('payments.paid_date_label') as HTMLInputElement;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(dateInput.value).toBe(todayStr);

    fireEvent.click(screen.getByText('payments.confirm_mark_paid'));

    expect(updateSpy).toHaveBeenCalledWith({
      id: 'p1',
      patch: { status: 'paid', paid_at: `${todayStr}T00:00:00Z` },
    });
  });

  it('submits a user-chosen past date instead of today', () => {
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    fireEvent.click(screen.getByText('payments.status_pending'));

    fireEvent.change(screen.getByLabelText('payments.paid_date_label'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByText('payments.confirm_mark_paid'));

    expect(updateSpy).toHaveBeenCalledWith({
      id: 'p1',
      patch: { status: 'paid', paid_at: '2026-08-01T00:00:00Z' },
    });
  });

  it('un-marking a paid row is immediate — no popover, paid_at cleared', () => {
    paymentRow.value = { ...row, status: 'paid', paid_at: '2026-08-01T00:00:00Z' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    openPastMonth();

    fireEvent.click(screen.getByText('payments.status_paid'));

    expect(updateSpy).toHaveBeenCalledWith({
      id: 'p1',
      patch: { status: 'pending', paid_at: null },
    });
  });
});

/**
 * A cancelled row must never get the same one-click toggle as pending/paid
 * rows — the DB guard (deal_payments_cancel_revive_trg) raises on a direct
 * cancelled -> paid update, so the UI has to route through a confirmed
 * restore-to-pending step instead.
 */
describe('PaymentsPanel cancelled row restore', () => {
  beforeEach(() => updateSpy.mockClear());

  it('shows a cancelled badge instead of the paid-date popover trigger', () => {
    paymentRow.value = { ...row, status: 'cancelled' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    openPastMonth();

    expect(screen.getByText('payments.status_cancelled')).toBeInTheDocument();
    expect(screen.queryByLabelText('payments.paid_date_label')).not.toBeInTheDocument();
  });

  it('asks for confirmation instead of updating immediately', () => {
    paymentRow.value = { ...row, status: 'cancelled' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    openPastMonth();

    expect(screen.queryByText('payments.restore_confirm_title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('payments.status_cancelled'));

    expect(screen.getByText('payments.restore_confirm_title')).toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('restores to pending with paid_at cleared once confirmed', () => {
    paymentRow.value = { ...row, status: 'cancelled', paid_at: '2026-06-01T00:00:00Z' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    openPastMonth();

    fireEvent.click(screen.getByText('payments.status_cancelled'));
    fireEvent.click(screen.getByText('payments.restore_to_pending'));

    expect(updateSpy).toHaveBeenCalledWith({
      id: 'p1',
      patch: { status: 'pending', paid_at: null },
    });
  });

  it('does not restore when the dialog is dismissed', () => {
    paymentRow.value = { ...row, status: 'cancelled' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    openPastMonth();

    fireEvent.click(screen.getByText('payments.status_cancelled'));
    fireEvent.click(screen.getByText('cancel'));

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

/**
 * Month grouping: an open (pending/overdue) month stays expanded in the main
 * list; a fully paid month that has passed moves into the collapsed Past
 * payments archive and is reachable, but not in the way, from there.
 */
describe('PaymentsPanel month grouping', () => {
  it('keeps an open month expanded in the main list, with no Past section', () => {
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);

    expect(screen.getByText('payments.status_pending')).toBeInTheDocument();
    expect(screen.queryByText('payments.past_title')).not.toBeInTheDocument();
  });

  it('moves a fully paid past month behind the Past payments toggle', () => {
    paymentRow.value = { ...row, status: 'paid', paid_at: '2026-07-05T00:00:00Z' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);

    // Nothing open: the main list says so, the row itself is hidden.
    expect(screen.getByText('payments.all_settled')).toBeInTheDocument();
    expect(screen.queryByText('payments.status_paid')).not.toBeInTheDocument();

    openPastMonth();
    expect(screen.getByText('payments.status_paid')).toBeInTheDocument();
  });
});

/**
 * Bulk mark-paid sweeps a month's open rows in one action — and, like the
 * per-row control, it must ask for the real payment date instead of stamping
 * "now" (the DB guard money_paid_needs_date requires it).
 */
describe('PaymentsPanel bulk mark paid for a month', () => {
  beforeEach(() => bulkSpy.mockClear());

  it('opens a date popover instead of paying immediately', () => {
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);

    fireEvent.click(screen.getByText('payments.bulk_mark_paid'));

    expect(bulkSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('payments.bulk_paid_date_label')).toBeInTheDocument();
  });

  it('submits the open row ids with the chosen date at midnight UTC', () => {
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    fireEvent.click(screen.getByText('payments.bulk_mark_paid'));

    fireEvent.change(screen.getByLabelText('payments.bulk_paid_date_label'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByText('payments.bulk_confirm_mark_paid'));

    expect(bulkSpy).toHaveBeenCalledWith({
      ids: ['p1'],
      paid_at: '2026-08-01T00:00:00Z',
    });
  });

  it('offers no bulk button on a month with nothing open', () => {
    paymentRow.value = { ...row, status: 'paid', paid_at: '2026-07-05T00:00:00Z' };
    render(<PaymentsPanel dealId="d1" services={[]} defaultVatRate={24} />);
    openPastMonth();

    expect(screen.queryByText('payments.bulk_mark_paid')).not.toBeInTheDocument();
  });
});
