import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { JobBillingRow, JobsBilling } from './hooks/useJobsBilling';

const updateMutate = vi.fn().mockResolvedValue('job-1');
const endMutate = vi.fn().mockResolvedValue('job-1');

vi.mock('./hooks/useCustomJobMutations', () => ({
  useUpdateJobBilling: () => ({ mutateAsync: updateMutate, isPending: false }),
  useEndJob: () => ({ mutateAsync: endMutate, isPending: false }),
}));

vi.mock('./hooks/useDealPayments', () => ({
  useUpdateDealPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const billing: { current: JobsBilling } = { current: { jobs: [], payments: [] } };
vi.mock('./hooks/useJobsBilling', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useJobsBilling')>(
    './hooks/useJobsBilling',
  );
  return {
    ...actual,
    useJobsBilling: () => ({ data: billing.current, isLoading: false }),
  };
});

import { JobsBillingPanel } from './JobsBillingPanel';

function makeJob(over: Partial<JobBillingRow> & { id: string }): JobBillingRow {
  return {
    title: `Job ${over.id}`,
    department: 'web_dev',
    billing_type: 'recurring_monthly',
    amount_net: 100,
    setup_fee: null,
    vat_rate: 24,
    billing_active: true,
    billing_only: false,
    billing_group_id: null,
    status: 'active',
    is_custom: true,
    description: null,
    ...over,
  };
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

function billingSelect(rowTitle: string) {
  const cell = screen.getByText(rowTitle).closest('tr') as HTMLElement;
  return within(cell).getByRole('combobox', { name: /billing/i });
}

describe('JobsBillingPanel grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-1111-1111-111111111111' as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  it('mints one shared group id for two ungrouped same-cadence jobs', async () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Hosting' }),
        makeJob({ id: 'b', title: 'Maintenance' }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(billingSelect('Hosting'));
    await user.click(await screen.findByRole('option', { name: /group with: maintenance/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(2));
    // Both jobs receive the SAME freshly-minted group id.
    expect(updateMutate).toHaveBeenCalledWith({
      jobId: 'b',
      billingGroupId: '11111111-1111-1111-1111-111111111111',
    });
    expect(updateMutate).toHaveBeenCalledWith({
      jobId: 'a',
      billingGroupId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('joins an existing group when the target job is already grouped', async () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Hosting' }),
        makeJob({ id: 'b', title: 'Maintenance', billing_group_id: 'grp-existing' }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(billingSelect('Hosting'));
    // Maintenance is in "Group 1"; choosing it assigns that existing group id.
    await user.click(await screen.findByRole('option', { name: /group 1/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith({ jobId: 'a', billingGroupId: 'grp-existing' });
  });

  it('clears the group when choosing "Bill separately"', async () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Hosting', billing_group_id: 'grp-1' }),
        makeJob({ id: 'b', title: 'Maintenance', billing_group_id: 'grp-1' }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(billingSelect('Hosting'));
    await user.click(await screen.findByRole('option', { name: /bill separately/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith({ jobId: 'a', clearGroup: true });
  });

  it('does not offer grouping across different cadences', async () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Hosting', billing_type: 'recurring_monthly' }),
        makeJob({ id: 'b', title: 'Yearly SEO', billing_type: 'recurring_yearly' }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(billingSelect('Hosting'));
    expect(screen.queryByRole('option', { name: /group with/i })).not.toBeInTheDocument();
  });

  it('does not offer grouping for one-time jobs', async () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Setup', billing_type: 'one_time' }),
        makeJob({ id: 'b', title: 'Logo', billing_type: 'one_time' }),
      ],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));

    // The control is disabled (no grouping actions available) for one-time jobs.
    expect(billingSelect('Setup')).toBeDisabled();
  });
});

describe('JobsBillingPanel readOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the "Add job" button and edit controls in read-only mode', () => {
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting' })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" readOnly />));

    expect(screen.queryByRole('button', { name: /add job/i })).not.toBeInTheDocument();
    // No price <input> and no billing-group <combobox> in read-only mode.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /billing/i })).not.toBeInTheDocument();
  });

  it('shows the "Add job" button in editable (default) mode', () => {
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting' })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));

    expect(screen.getByRole('button', { name: /add job/i })).toBeInTheDocument();
  });
});
