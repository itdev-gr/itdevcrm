import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, is, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const range = vi.fn();
  const is = vi.fn();
  const select = vi.fn();
  const from = vi.fn();
  return { order, range, is, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useCronAlerts } from './useCronAlerts';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useCronAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Chainable query mock: .from().select().is().order().range() resolves.
    const range = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'a1',
          kind: 'flip_out_of_paid_in_full',
          subject_type: 'deal',
          subject_id: 'd1',
          details: { next_due: '2026-06-21' },
          detected_at: '2026-07-01T08:38:52Z',
          resolved_at: null,
          resolved_by: null,
        },
      ],
      error: null,
    });
    order.mockReturnValue({ range });
    is.mockReturnValue({ order });
    select.mockReturnValue({ is });
    from.mockReturnValue({ select });
  });

  it('queries data_integrity_alerts for open rows via the paged drain, newest-detected first', async () => {
    const { result } = renderHook(() => useCronAlerts(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('data_integrity_alerts');
    expect(select).toHaveBeenCalledWith('*');
    expect(is).toHaveBeenCalledWith('resolved_at', null);
    expect(order).toHaveBeenCalledWith('detected_at', { ascending: false });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.kind).toBe('flip_out_of_paid_in_full');
  });

  it('surfaces a load error (e.g. RLS denial for a non-admin) as a rejection', async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    order.mockReturnValue({ range });
    const { result } = renderHook(() => useCronAlerts(), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('permission denied');
  });
});
