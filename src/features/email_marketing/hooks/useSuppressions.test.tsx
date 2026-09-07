import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { useAuthStore } from '@/lib/stores/authStore';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useSuppressions, SUPPRESSIONS_PAGE_SIZE } from './useSuppressions';

// A minimal stand-in for supabase-js's PostgrestFilterBuilder: every chain
// method returns the SAME object (so `.select().order().range()` and
// `.select().order().range().ilike().eq()` are both valid chains), and the
// object itself is thenable, so `await query` resolves no matter where in
// the chain the caller stopped — exactly how the real client behaves, and
// what lets useSuppressions.ts build the query conditionally (`if (term)
// query = query.ilike(...)`) before awaiting it.
type Builder = {
  select: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => unknown) => unknown;
};

let builder: Builder;
let queryResult: { data: unknown[]; error: unknown; count: number };

function makeBuilder(): Builder {
  const b = {} as Builder;
  b.select = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.range = vi.fn(() => b);
  b.ilike = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.then = (resolve) => Promise.resolve(queryResult).then(resolve);
  return b;
}

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useSuppressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Admin-only per the feature's standing rule — the hook's `enabled`
    // gate would otherwise never issue the query at all.
    useAuthStore.setState({ isAdmin: true });
    queryResult = { data: [], error: null, count: 0 };
    builder = makeBuilder();
    from.mockReturnValue(builder);
  });

  it('sends the search term server-side as an ilike filter — never fetches then filters in the browser', async () => {
    const { result } = renderHook(() => useSuppressions({ search: 'bounced@example' }), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(from).toHaveBeenCalledWith('email_suppressions');
    expect(builder.ilike).toHaveBeenCalledWith('email_lower', '%bounced@example%');
  });

  it('omits the ilike filter entirely when there is no search term', async () => {
    const { result } = renderHook(() => useSuppressions({}), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.ilike).not.toHaveBeenCalled();
  });

  it('pages server-side via .range() for the requested page, not by loading everything', async () => {
    const { result } = renderHook(() => useSuppressions({ page: 2 }), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.range).toHaveBeenCalledWith(
      2 * SUPPRESSIONS_PAGE_SIZE,
      2 * SUPPRESSIONS_PAGE_SIZE + SUPPRESSIONS_PAGE_SIZE - 1,
    );
  });

  it('applies both the search and reason filters together when both are set', async () => {
    const { result } = renderHook(() => useSuppressions({ search: 'foo', reason: 'complaint' }), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.ilike).toHaveBeenCalledWith('email_lower', '%foo%');
    expect(builder.eq).toHaveBeenCalledWith('reason', 'complaint');
  });
});
