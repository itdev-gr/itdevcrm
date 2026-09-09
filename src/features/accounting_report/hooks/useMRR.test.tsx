import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { range, from, eq, gte, lte } = vi.hoisted(() => {
  const range = vi.fn();
  const chain: Record<string, unknown> = { range };
  const eq = vi.fn().mockReturnValue(chain);
  const gte = vi.fn().mockReturnValue(chain);
  const lte = vi.fn().mockReturnValue(chain);
  chain['eq'] = eq;
  chain['gte'] = gte;
  chain['lte'] = lte;
  chain['order'] = vi.fn().mockReturnValue(chain);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { range, from, eq, gte, lte };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useMRR } from './useMRR';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useMRR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums NET amounts of recurring income RECEIVED in the range (ledger event_date)', async () => {
    // Owner decision 2026-09-09 (report audit, decision 1): the caption says
    // «εισπράχθηκαν στην περίοδο», so this measures receipts via the ledger's
    // Athens-local paid date — not billing-period overlap.
    range.mockResolvedValue({
      data: [
        { amount_net: 200 },
        { amount_net: 161.29 },
        { amount_net: null },
      ],
      error: null,
    });
    const { result } = renderHook(() => useMRR({ from: '2026-09-01', to: '2026-09-30' }), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('accounting_ledger_v');
    expect(eq).toHaveBeenCalledWith('direction', 'in');
    expect(eq).toHaveBeenCalledWith('billing_type', 'recurring_monthly');
    expect(eq).toHaveBeenCalledWith('status', 'paid');
    expect(gte).toHaveBeenCalledWith('event_date', '2026-09-01');
    expect(lte).toHaveBeenCalledWith('event_date', '2026-09-30');
    expect(result.current.data).toBeCloseTo(361.29, 2);
  });
});
