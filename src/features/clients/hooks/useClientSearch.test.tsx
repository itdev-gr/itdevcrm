import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, from } = vi.hoisted(() => {
  const order = vi.fn();
  const limit = vi.fn().mockReturnValue({ order });
  const or = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ or });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, from };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useClientSearch } from './useClientSearch';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useClientSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idle (no query) for terms shorter than 2 chars', () => {
    const { result } = renderHook(() => useClientSearch('a'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
  });

  it('searches clients by name/code and returns rows', async () => {
    order.mockResolvedValue({
      data: [{ id: 'c1', name: 'ACME', code: '004583' }],
      error: null,
    });
    const { result } = renderHook(() => useClientSearch('ac'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(from).toHaveBeenCalledWith('clients');
    expect(eq).toHaveBeenCalledWith('archived', false);
    expect(result.current.data).toEqual([{ id: 'c1', name: 'ACME', code: '004583' }]);
  });
});
