import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useGroups } from './useGroups';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGroups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches groups and returns sorted list', async () => {
    order.mockResolvedValue({
      data: [
        {
          id: '1',
          code: 'sales',
          display_names: { en: 'Sales', el: 'Π' },
          parent_label: 'Sales',
          position: 10,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useGroups(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe('sales');
    expect(from).toHaveBeenCalledWith('groups');
  });
});
