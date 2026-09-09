import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { range, from, eq } = vi.hoisted(() => {
  const range = vi.fn();
  const chain: Record<string, unknown> = { range };
  const eq = vi.fn().mockReturnValue(chain);
  chain['eq'] = eq;
  for (const m of ['neq', 'order']) {
    const fn = vi.fn().mockReturnValue(chain);
    chain[m] = fn;
  }
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { range, from, eq };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useContractedMRR } from './useContractedMRR';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useContractedMRR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums monthly jobs at face value and yearly jobs at amount/12', async () => {
    range.mockResolvedValue({
      data: [
        { amount_net: 900, billing_type: 'recurring_monthly' },
        { amount_net: 650, billing_type: 'recurring_monthly' },
        // Yearly jobs store the ANNUAL amount in amount_net.
        { amount_net: 30, billing_type: 'recurring_yearly' },
        { amount_net: null, billing_type: 'recurring_monthly' },
      ],
      error: null,
    });
    const { result } = renderHook(() => useContractedMRR(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('jobs');
    expect(result.current.data).toBe(1552.5);
  });

  it('excludes paused jobs — billing must be active to count as contracted', async () => {
    // Owner decision 2026-09-09 (report audit, decision 2): paused/held
    // clients (billing_active=false) are not current contracted revenue.
    range.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useContractedMRR(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eq).toHaveBeenCalledWith('billing_active', true);
  });
});
