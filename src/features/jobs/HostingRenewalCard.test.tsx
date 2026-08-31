import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { HostingRenewalRow } from './hooks/useHostingRenewal';

const state = vi.hoisted(() => ({
  payment: null as HostingRenewalRow | null,
  isAdmin: false,
  groupCodes: [] as string[],
  mutateAsync: vi.fn(),
}));

vi.mock('./hooks/useHostingRenewal', () => ({
  useHostingRenewalPayment: () => ({ data: state.payment, isLoading: false }),
}));
vi.mock('@/features/deals/hooks/useDealPayments', () => ({
  useUpdateDealPayment: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; groupCodes: string[] }) => unknown) =>
    sel({ isAdmin: state.isAdmin, groupCodes: state.groupCodes }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { HostingRenewalCard } from './HostingRenewalCard';

const paid: HostingRenewalRow = {
  id: 'p1',
  start_date: '2026-05-21',
  end_date: '2027-05-21',
  status: 'paid',
  paid_at: '2026-06-19T00:00:00Z',
};

describe('HostingRenewalCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.payment = paid;
    state.isAdmin = false;
    state.groupCodes = ['accounting'];
    state.mutateAsync.mockResolvedValue(undefined);
  });

  it('shows the chain-head end_date and saves an edited renewal date', () => {
    render(<HostingRenewalCard jobId="j1" dealId="d1" />);
    const input = screen.getByLabelText(/renewal date/i) as HTMLInputElement;
    expect(input.value).toBe('2027-05-21');

    fireEvent.change(input, { target: { value: '2027-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(state.mutateAsync).toHaveBeenCalledWith({ id: 'p1', patch: { end_date: '2027-09-15' } });
  });

  it('is read-only for users outside accounting/admin', () => {
    state.groupCodes = ['web_dev'];
    render(<HostingRenewalCard jobId="j1" dealId="d1" />);
    expect((screen.getByLabelText(/renewal date/i) as HTMLInputElement).disabled).toBe(true);
  });

  it('explains the pending case (due updates on payment)', () => {
    state.payment = { ...paid, status: 'pending', paid_at: null };
    render(<HostingRenewalCard jobId="j1" dealId="d1" />);
    expect(screen.getByText(/updates when this charge is marked paid/i)).toBeInTheDocument();
  });

  it('renders the empty state when no hosting payment exists', () => {
    state.payment = null;
    render(<HostingRenewalCard jobId="j1" dealId="d1" />);
    expect(screen.getByText(/no hosting payment exists yet/i)).toBeInTheDocument();
  });
});
