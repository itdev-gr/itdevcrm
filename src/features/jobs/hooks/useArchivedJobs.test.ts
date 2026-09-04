import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Final-review I3: the archived column used to scope its query to the exact
// service_type ('local_seo'), while the live board query
// (useJobs.ts:serviceTypesForBoard) folds ai_seo in too. A cascade-archived
// ai_seo work card therefore left the live board and had nowhere to land —
// its admin Restore became unreachable. Both queries must agree on scope.
const { supabaseFrom, supabaseIn, supabaseEq } = vi.hoisted(() => {
  const limit = vi.fn().mockResolvedValue({ data: [], error: null });
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const inFn = vi.fn(() => ({ eq }));
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { supabaseFrom: from, supabaseIn: inFn, supabaseEq: eq };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseFrom } }));

import { useArchivedJobs } from './useArchivedJobs';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useArchivedJobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('folds ai_seo into the local_seo archived query, matching the live board scope', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useArchivedJobs('local_seo', true), { wrapper: wrap(qc) });

    await waitFor(() => expect(supabaseIn).toHaveBeenCalled());
    expect(supabaseFrom).toHaveBeenCalledWith('jobs');
    expect(supabaseIn).toHaveBeenCalledWith('service_type', ['local_seo', 'ai_seo']);
    expect(supabaseEq).toHaveBeenCalledWith('archived', true);
  });

  it('folds ai_seo into the web_seo archived query too', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useArchivedJobs('web_seo', true), { wrapper: wrap(qc) });

    await waitFor(() => expect(supabaseIn).toHaveBeenCalled());
    expect(supabaseIn).toHaveBeenCalledWith('service_type', ['web_seo', 'ai_seo']);
  });

  it('does not widen the scope for a board with no ai_seo fold-in', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useArchivedJobs('hosting', true), { wrapper: wrap(qc) });

    await waitFor(() => expect(supabaseIn).toHaveBeenCalled());
    expect(supabaseIn).toHaveBeenCalledWith('service_type', ['hosting']);
  });

  it('does not query at all when disabled', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useArchivedJobs('hosting', false), { wrapper: wrap(qc) });
    expect(supabaseFrom).not.toHaveBeenCalled();
  });
});
