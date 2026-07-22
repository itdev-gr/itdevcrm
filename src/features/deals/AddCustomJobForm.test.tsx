import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const mutateAsync = vi.fn().mockResolvedValue('job-1');
vi.mock('./hooks/useCustomJobMutations', () => ({
  useCreateCustomJob: () => ({ mutateAsync, isPending: false }),
}));

import { AddCustomJobForm } from './AddCustomJobForm';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('AddCustomJobForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps submit disabled until both title and price are set', async () => {
    const user = userEvent.setup();
    render(wrap(<AddCustomJobForm dealId="d1" />));

    const submit = screen.getByRole('button', { name: /add job/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^title$/i), 'Extra landing page');
    expect(submit).toBeDisabled(); // price still missing

    await user.type(screen.getByLabelText(/price \(net/i), '500');
    expect(submit).toBeEnabled();
  });

  it('submits the entered values via createCustomJob', async () => {
    const user = userEvent.setup();
    render(wrap(<AddCustomJobForm dealId="d1" defaultVatRate={24} />));

    await user.type(screen.getByLabelText(/^title$/i), 'Extra landing page');
    await user.type(screen.getByLabelText(/price \(net/i), '500');
    await user.click(screen.getByRole('button', { name: /add job/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      title: 'Extra landing page',
      description: null,
      department: 'web_dev', // default
      billingType: 'one_time', // default cadence
      amountNet: 500,
      vatRate: 24,
      setupFee: 0,
      billingOnly: false,
      installmentPlan: 'none', // default = no split
      installmentSchedule: null, // no custom schedule on a 'none' plan
      force: false, // guardrail not overridden
    });
  });

  it('offers the payment plan selector for the default web_dev one-time job', () => {
    render(wrap(<AddCustomJobForm dealId="d1" />));
    expect(screen.getByRole('combobox', { name: /payment plan/i })).toBeInTheDocument();
  });

  it('submits the chosen installment plan', async () => {
    const user = userEvent.setup();
    render(wrap(<AddCustomJobForm dealId="d1" defaultVatRate={24} />));

    await user.type(screen.getByLabelText(/^title$/i), 'Website');
    await user.type(screen.getByLabelText(/price \(net/i), '1000');
    await user.click(screen.getByRole('combobox', { name: /payment plan/i }));
    await user.click(await screen.findByRole('option', { name: /50 . 50 \(2/i }));
    await user.click(screen.getByRole('button', { name: /add job/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ installmentPlan: '50_50', amountNet: 1000 }),
    );
  });

  it('offers the payment plan selector for a franchise one-time job', async () => {
    const user = userEvent.setup();
    render(wrap(<AddCustomJobForm dealId="d1" />));

    await user.click(screen.getByRole('combobox', { name: /department/i }));
    await user.click(await screen.findByRole('option', { name: /^franchise$/i }));
    expect(screen.getByRole('combobox', { name: /payment plan/i })).toBeInTheDocument();
  });

  it('hides the plan selector when the cadence is recurring', async () => {
    const user = userEvent.setup();
    render(wrap(<AddCustomJobForm dealId="d1" />));

    expect(screen.getByRole('combobox', { name: /payment plan/i })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /cadence/i }));
    await user.click(await screen.findByRole('option', { name: /monthly/i }));
    expect(screen.queryByRole('combobox', { name: /payment plan/i })).not.toBeInTheDocument();
  });

  it('sends the multi-line "Notes from accounting" value through to create', async () => {
    const user = userEvent.setup();
    render(wrap(<AddCustomJobForm dealId="d1" />));

    await user.type(screen.getByLabelText(/^title$/i), 'New site');
    await user.type(screen.getByLabelText(/price \(net/i), '1200');

    const notes = screen.getByLabelText(/notes from accounting/i);
    expect(notes.tagName).toBe('TEXTAREA');
    await user.type(notes, 'Line 1{enter}Line 2');

    await user.click(screen.getByRole('button', { name: /add job/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({
      description: 'Line 1\nLine 2',
    });
  });
});
