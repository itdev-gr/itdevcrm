import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { DealPaymentRow } from './hooks/useDealPayments';

// t=(k)=>k keeps assertions independent of the i18n catalog.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const updateSpy = vi.fn().mockResolvedValue(undefined);
const deleteSpy = vi.fn().mockResolvedValue(undefined);

// Flat mock of the data hooks so the update mutation is a spy and no supabase
// client is touched.
vi.mock('./hooks/useDealPayments', () => ({
  dealPaymentsKey: (dealId: string) => ['deal-payments', dealId],
  useDealPayments: () => ({ data: [paymentRow.value], isLoading: false }),
  useUpdateDealPayment: () => ({ mutateAsync: updateSpy, isPending: false }),
  useAddDealPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealPayment: () => ({ mutateAsync: deleteSpy, isPending: false }),
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
