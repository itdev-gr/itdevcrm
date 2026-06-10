import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { clientArchivedEq, from } = vi.hoisted(() => {
  const clientArchivedEq = vi.fn();
  const neq = vi.fn().mockReturnValue({ eq: clientArchivedEq });
  const archivedEq = vi.fn().mockReturnValue({ neq });
  const statusEq = vi.fn().mockReturnValue({ eq: archivedEq });
  const select = vi.fn().mockReturnValue({ eq: statusEq });
  const from = vi.fn().mockReturnValue({ select });
  return { clientArchivedEq, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useContractedMRR } from './useContractedMRR';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useContractedMRR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums monthly_amount of active recurring jobs (matches the Recurring page total)', async () => {
    clientArchivedEq.mockResolvedValue({
      data: [{ monthly_amount: 900 }, { monthly_amount: 650 }, { monthly_amount: null }],
      error: null,
    });
    const { result } = renderHook(() => useContractedMRR(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('jobs');
    expect(result.current.data).toBe(1550);
  });
});
