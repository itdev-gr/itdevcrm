import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

// Mirror @supabase/supabase-js: `from()` is a prototype method whose body
// dereferences `this` (e.g. `this.rest`). Capturing `supabase.from` into a
// bare const detaches `this`, which crashes with
// "Cannot read properties of undefined (reading 'rest')" before any request
// is ever sent — silently breaking both the read and the toggle update.
const { restFrom } = vi.hoisted(() => ({ restFrom: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rest: { from: restFrom },
    from(table: string) {
      return this.rest.from(table);
    },
  },
}));

import { useLeadDistribution } from './useLeadDistribution';

function builder(autoEnabled: boolean) {
  return {
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: { auto_enabled: autoEnabled }, error: null }),
      }),
    }),
    update: () => ({
      eq: () => Promise.resolve({ error: null }),
    }),
  };
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('useLeadDistribution', () => {
  beforeEach(() => {
    restFrom.mockReset();
    restFrom.mockReturnValue(builder(true));
  });

  it('reads auto_enabled without losing the supabase `this` binding', async () => {
    const { result } = renderHook(() => useLeadDistribution(), { wrapper: wrap(makeClient()) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.autoEnabled).toBe(true);
    expect(restFrom).toHaveBeenCalledWith('lead_distribution_state');
  });

  it('setEnabled persists the toggle without losing the `this` binding', async () => {
    const { result } = renderHook(() => useLeadDistribution(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    restFrom.mockClear();

    await result.current.setEnabled.mutateAsync(true);

    expect(restFrom).toHaveBeenCalledWith('lead_distribution_state');
  });
});
