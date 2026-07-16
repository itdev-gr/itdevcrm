import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { DealPaymentRow } from './hooks/useDealPayments';

// t=(k)=>k keeps assertions independent of the i18n catalog.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const updateSpy = vi.fn().mockResolvedValue(undefined);

// Flat mock of the data hooks so the update mutation is a spy and no supabase
// client is touched.
vi.mock('./hooks/useDealPayments', () => ({
  dealPaymentsKey: (dealId: string) => ['deal-payments', dealId],
  useDealPayments: () => ({ data: [row], isLoading: false }),
  useUpdateDealPayment: () => ({ mutateAsync: updateSpy, isPending: false }),
  useAddDealPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { PaymentsPanel } from './PaymentsPanel';

const row: DealPaymentRow = {
  id: 'p1',
  deal_id: 'd1',
  amount: 100,
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
