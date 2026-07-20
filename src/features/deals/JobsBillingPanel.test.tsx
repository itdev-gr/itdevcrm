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

const pauseMutate = vi.fn().mockResolvedValue(undefined);
const resumeMutate = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/jobs/hooks/useJobBillingPause', () => ({
  useJobPauseBilling: () => ({ mutateAsync: pauseMutate, isPending: false }),
  useJobResumeBilling: () => ({ mutateAsync: resumeMutate, isPending: false }),
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
    installment_plan: 'none',
    installment_schedule: null,
    amount_net: 100,
    setup_fee: null,
    vat_rate: 24,
    billing_active: true,
    billing_only: false,
    billing_group_id: null,
    status: 'active',
    is_custom: true,
    description: null,
    parent_job_id: null,
    blocked_reason: null,
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

function termSelect(rowTitle: string) {
  const cell = screen.getByText(rowTitle).closest('tr') as HTMLElement;
  return within(cell).getByRole('combobox', { name: /term/i });
}

describe('JobsBillingPanel term', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('changes a job billing term via the Term dropdown', async () => {
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting', billing_type: 'recurring_monthly' })],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(termSelect('Hosting'));
    await user.click(await screen.findByRole('option', { name: /yearly/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith({ jobId: 'a', billingType: 'recurring_yearly' });
  });

  it('clears grouping when switching a grouped job to One-time', async () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Hosting', billing_type: 'recurring_monthly', billing_group_id: 'grp-1' }),
        makeJob({ id: 'b', title: 'Maintenance', billing_type: 'recurring_monthly', billing_group_id: 'grp-1' }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(termSelect('Hosting'));
    await user.click(await screen.findByRole('option', { name: /one-time/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith({
      jobId: 'a',
      billingType: 'one_time',
      clearGroup: true,
    });
  });

  it('hides the Term dropdown in read-only mode', () => {
    billing.current = { jobs: [makeJob({ id: 'a', title: 'Hosting' })], payments: [] };
    render(wrap(<JobsBillingPanel dealId="d1" readOnly />));
    expect(screen.queryByRole('combobox', { name: /term/i })).not.toBeInTheDocument();
  });
});

function planSelect(rowTitle: string) {
  const cell = screen.getByText(rowTitle).closest('tr') as HTMLElement;
  return within(cell).getByRole('combobox', { name: /payment plan/i });
}

describe('JobsBillingPanel installment plan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the plan dropdown for a one-time web_dev job', () => {
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Website', department: 'web_dev', billing_type: 'one_time' })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(planSelect('Website')).toBeInTheDocument();
  });

  it('does not offer the plan dropdown for non-web_dev or recurring jobs', () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'SEO', department: 'web_seo', billing_type: 'one_time' }),
        makeJob({ id: 'b', title: 'Hosting', department: 'web_dev', billing_type: 'recurring_monthly' }),
      ],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.queryByRole('combobox', { name: /payment plan/i })).not.toBeInTheDocument();
  });

  it('saves the chosen plan via updateJobBilling', async () => {
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Website', department: 'web_dev', billing_type: 'one_time' })],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(planSelect('Website'));
    await user.click(await screen.findByRole('option', { name: /50 . 25 . 25/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith({ jobId: 'a', installmentPlan: '50_25_25' });
  });

  it('previews the split for a job that already has a plan', () => {
    billing.current = {
      jobs: [
        makeJob({
          id: 'a',
          title: 'Website',
          department: 'web_dev',
          billing_type: 'one_time',
          installment_plan: '50_50',
          amount_net: 1000,
        }),
      ],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const cell = screen.getByText('Website').closest('tr') as HTMLElement;
    expect(within(cell).getByText(/Splits to/i)).toBeInTheDocument();
  });

  it('opens the schedule editor seeded from the saved schedule via Edit payments', async () => {
    billing.current = {
      jobs: [
        makeJob({
          id: 'a',
          title: 'Website',
          department: 'web_dev',
          billing_type: 'one_time',
          installment_plan: 'custom',
          installment_schedule: [
            { amount_net: 600, due_date: '2026-08-01' },
            { amount_net: 400, due_date: null },
          ],
          amount_net: 1000,
        }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    const row = screen.getByText('Website').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /edit payments/i }));

    // Editor shows the two saved rows (amount inputs are labelled "Amount").
    const amounts = within(row).getAllByRole('spinbutton', { name: /amount/i });
    expect(amounts.map((el) => (el as HTMLInputElement).value)).toEqual(['600', '400']);
    expect(within(row).getAllByLabelText(/due date/i)[0]).toHaveValue('2026-08-01');
    expect(within(row).getByRole('button', { name: /save schedule/i })).toBeInTheDocument();
    // The trigger hides while the editor is open.
    expect(within(row).queryByRole('button', { name: /edit payments/i })).not.toBeInTheDocument();
  });

  it('seeds a single full-amount row when a custom job has no saved schedule', async () => {
    billing.current = {
      jobs: [
        makeJob({
          id: 'a',
          title: 'Website',
          department: 'web_dev',
          billing_type: 'one_time',
          installment_plan: 'custom',
          installment_schedule: null,
          amount_net: 1000,
        }),
      ],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    const row = screen.getByText('Website').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /edit payments/i }));

    const amounts = within(row).getAllByRole('spinbutton', { name: /amount/i });
    expect(amounts.map((el) => (el as HTMLInputElement).value)).toEqual(['1000']);
  });

  it('does not show Edit payments for non-custom plans', () => {
    billing.current = {
      jobs: [
        makeJob({
          id: 'a',
          title: 'Website',
          department: 'web_dev',
          billing_type: 'one_time',
          installment_plan: '50_50',
        }),
      ],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.queryByRole('button', { name: /edit payments/i })).not.toBeInTheDocument();
  });
});

describe('JobsBillingPanel billing errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('alerts the translated message when a term change fails with a billing error code', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    updateMutate.mockRejectedValueOnce(
      Object.assign(new Error('cannot_replan_paid_installment'), {
        errors: ['cannot_replan_paid_installment'],
      }),
    );
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting', billing_type: 'recurring_monthly' })],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    await user.click(termSelect('Hosting'));
    await user.click(await screen.findByRole('option', { name: /yearly/i }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Can't change the plan — an installment is already paid or invoiced.",
      ),
    );
    alertSpy.mockRestore();
  });

  it('alerts the translated message when a price edit fails with a billing error code', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    updateMutate.mockRejectedValueOnce(
      Object.assign(new Error('schedule_total_mismatch'), {
        errors: ['schedule_total_mismatch'],
      }),
    );
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting', amount_net: 100 })],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));

    const row = screen.getByText('Hosting').closest('tr') as HTMLElement;
    const priceInput = within(row).getByRole('spinbutton');
    await user.clear(priceInput);
    await user.type(priceInput, '123');
    await user.tab();

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Payments must add up to the job price.'),
    );
    alertSpy.mockRestore();
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

describe('JobsBillingPanel invoiced date', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the invoiced date when provided', () => {
    billing.current = { jobs: [], payments: [] };
    render(wrap(<JobsBillingPanel dealId="d1" invoicedDate="2026-05-21" />));
    expect(screen.getByTestId('jobs-billing-invoiced-date')).toHaveTextContent('2026');
  });

  it('shows an em dash when there is no invoiced date', () => {
    billing.current = { jobs: [], payments: [] };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.getByTestId('jobs-billing-invoiced-date')).toHaveTextContent('—');
  });
});

describe('JobsBillingPanel note preview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a truncated single-line note preview under a job row', () => {
    const longNote = 'A'.repeat(150);
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting', description: longNote })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));

    const previewRow = screen.getByTestId('note-preview-a');
    const cell = previewRow.querySelector('td')!;
    // 120 chars + the ellipsis character is 121 visible chars.
    expect(cell.textContent!.length).toBeLessThanOrEqual(121);
    expect(cell.textContent!.startsWith('AAA')).toBe(true);
    expect(cell.getAttribute('title')).toBe(longNote);
  });

  it('does not render a preview row when the job has no description', () => {
    billing.current = {
      jobs: [makeJob({ id: 'b', title: 'Hosting', description: null })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.queryByTestId('note-preview-b')).toBeNull();
  });

  it('does not truncate notes shorter than 120 chars and omits the ellipsis', () => {
    const short = 'Short note';
    billing.current = {
      jobs: [makeJob({ id: 'c', title: 'Hosting', description: short })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const cell = screen.getByTestId('note-preview-c').querySelector('td')!;
    expect(cell.textContent).toBe(short);
  });
});

describe('JobsBillingPanel pause/resume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Pause for a recurring parent active job and calls the pause hook', async () => {
    billing.current = { jobs: [makeJob({ id: 'a', title: 'SEO', billing_type: 'recurring_monthly' })], payments: [] };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const row = screen.getByText('SEO').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /pause billing/i }));
    await user.click(await screen.findByRole('button', { name: /^pause billing$/i }));
    await waitFor(() => expect(pauseMutate).toHaveBeenCalledTimes(1));
  });

  it('shows a Paused badge + Resume for a paused job and calls the resume hook', async () => {
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'SEO', billing_type: 'recurring_monthly', blocked_reason: 'billing_paused' })],
      payments: [],
    };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const row = screen.getByText('SEO').closest('tr') as HTMLElement;
    expect(within(row).getByText(/paused/i)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /resume billing/i }));
    await user.click(await screen.findByRole('button', { name: /^resume billing$/i }));
    await waitFor(() => expect(resumeMutate).toHaveBeenCalledTimes(1));
  });

  it('shows no pause control for one-time / child jobs', () => {
    billing.current = {
      jobs: [
        makeJob({ id: 'a', title: 'Setup', billing_type: 'one_time' }),
        makeJob({ id: 'b', title: 'Child', billing_type: 'recurring_monthly', parent_job_id: 'p1' }),
      ],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.queryByRole('button', { name: /pause billing/i })).not.toBeInTheDocument();
  });

  it('hides pause/resume controls in read-only mode', () => {
    billing.current = { jobs: [makeJob({ id: 'a', title: 'SEO', billing_type: 'recurring_monthly' })], payments: [] };
    render(wrap(<JobsBillingPanel dealId="d1" readOnly />));
    expect(screen.queryByRole('button', { name: /pause billing/i })).not.toBeInTheDocument();
  });
});
