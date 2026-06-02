import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, functions: { invoke } } }));

import { useGoogleConnection } from './useGoogleConnection';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGoogleConnection', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reports connected status from my_google_status()', async () => {
    rpc.mockResolvedValue({ data: [{ google_email: 'me@itdev.gr', connected: true }], error: null });
    const { result } = renderHook(() => useGoogleConnection(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.email).toBe('me@itdev.gr');
  });
});
