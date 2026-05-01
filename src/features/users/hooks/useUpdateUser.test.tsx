import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { eq, update, from } = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { eq, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useUpdateUser } from './useUpdateUser';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useUpdateUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls supabase update with patch and userId', async () => {
    eq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useUpdateUser(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ userId: 'u1', full_name: 'Alice' });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ full_name: 'Alice' });
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('throws on supabase error', async () => {
    eq.mockResolvedValue({ error: { message: 'fail' } });
    const { result } = renderHook(() => useUpdateUser(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync({ userId: 'u1', full_name: 'X' })).rejects.toThrow(
      'fail',
    );
  });
});
