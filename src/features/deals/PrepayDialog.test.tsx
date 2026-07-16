import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const calls: Array<{ months: number; dryRun: boolean }> = [];
const result: { value: Record<string, unknown> } = { value: {} };
// Flat mock — do NOT importOriginal: the real module instantiates the supabase
// client at import time. The component's type-only imports are erased at runtime.
vi.mock('@/lib/rpc', () => ({
  accountingPrepayMonths: (_dealId: string, months: number, dryRun: boolean) => {
    calls.push({ months, dryRun });
    return Promise.resolve(result.value);
  },
}));

import { PrepayDialog } from './PrepayDialog';

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const PREVIEW = {
  ok: true,
  dry_run: true,
  months: 3,
  groups: [
    { group_key: 'solo:j1', services: ['local_seo'], monthly_net: 250, from: '2026-08-01', to: '2026-11-01', created: 3 },
  ],
};

describe('PrepayDialog', () => {
  beforeEach(() => {
    calls.length = 0;
    result.value = PREVIEW;
  });

  it('fetches a dry-run preview on open and shows chain + total', async () => {
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ months: 3, dryRun: true });
    expect(await screen.findByText(/local_seo/i)).toBeInTheDocument();
    // total = 250 * 3
    expect(screen.getByText(/750\.00/)).toBeInTheDocument();
  });

  it('re-fetches the preview when months change', async () => {
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    await waitFor(() => expect(calls).toHaveLength(1));
    await userEvent.selectOptions(screen.getByRole('combobox'), '5');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ months: 5, dryRun: true });
  });

  it('confirm records the prepayment (dryRun false) and shows the result', async () => {
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    await waitFor(() => expect(calls).toHaveLength(1));
    result.value = { ok: true, dry_run: false, months: 3, periods_created: 3, skipped_duplicates: 0, groups: PREVIEW.groups };
    await userEvent.click(screen.getByRole('button', { name: /record|καταχώριση/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ months: 3, dryRun: false });
    expect(await screen.findByText(/recorded .* as paid|ως πληρωμένες/i)).toBeInTheDocument();
  });

  it('shows the no-monthly-chain message when the RPC reports it', async () => {
    result.value = { ok: false, errors: ['no_monthly_chain'] };
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    expect(await screen.findByText(/monthly|μηνια/i)).toBeInTheDocument();
  });
});
