import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { useAuthStore } from '@/lib/stores/authStore';
import { useEffectivePermission } from './useEffectivePermission';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useEffectivePermission', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useAuthStore
      .getState()
      .setSession({ access_token: 't' } as never, { id: 'u1', email: 'a@b' } as never);
    vi.clearAllMocks();
  });

  it('returns allowed=false when not granted', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { result } = renderHook(() => useEffectivePermission('sales', 'edit'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.scope).toBeNull();
  });

  it('returns allowed=true + scope when granted', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'current_user_can' ? { data: true, error: null } : { data: 'group', error: null },
      ),
    );
    const { result } = renderHook(() => useEffectivePermission('sales', 'edit'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => {
      expect(result.current.allowed).toBe(true);
      expect(result.current.scope).toBe('group');
    });
  });
});
