import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

// Build the chain: from(...).select(...).eq(...).maybeSingle()
const { maybeSingle, eq, select, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { maybeSingle, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useDeal } from './useDeal';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  from.mockClear();
  select.mockClear();
  eq.mockClear();
  maybeSingle.mockReset();
});

describe('useDeal', () => {
  it('returns the row when the deal exists and the viewer can see it', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'd1', title: 'Test deal' }, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeal('d1'), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: 'd1' });
  });

  it('throws a NotAccessible error (not the cryptic Postgres message) when RLS hides the row', async () => {
    // maybeSingle returns {data: null, error: null} when 0 rows match — the
    // RLS-hidden case for a service-team user who hit a deep-link to a deal
    // they have no view on.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeal('d-hidden'), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.name).toBe('NotAccessible');
  });

  it('propagates a real backend error verbatim', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeal('d-err'), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('connection refused');
    expect(result.current.error?.name).not.toBe('NotAccessible');
  });
});
