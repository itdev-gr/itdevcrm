import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { deadEndLeadIds } = vi.hoisted(() => ({ deadEndLeadIds: vi.fn() }));
vi.mock('@/lib/rpc', () => ({ deadEndLeadIds }));

import { useDeadEndLeads } from './useDeadEndLeads';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDeadEndLeads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty set and does not query when there are no ids', () => {
    const { result } = renderHook(() => useDeadEndLeads([]), { wrapper });
    expect(result.current.size).toBe(0);
    expect(deadEndLeadIds).not.toHaveBeenCalled();
  });

  it('returns a set of the dead-end ids the rpc reports', async () => {
    deadEndLeadIds.mockResolvedValue(['L1']);
    const { result } = renderHook(() => useDeadEndLeads(['L1', 'L2']), { wrapper });
    await waitFor(() => expect(result.current.has('L1')).toBe(true));
    expect(result.current.has('L2')).toBe(false);
  });
});
