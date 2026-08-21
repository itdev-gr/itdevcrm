import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, insert, from } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { single, insert, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useCreateContract } from './useCreateContract';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useCreateContract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a draft contract and returns its id', async () => {
    single.mockResolvedValue({ data: { id: 'k1' }, error: null });
    const { result } = renderHook(() => useCreateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({
      client_id: 'c1', template_id: 't1', title: 'Σύμβαση Web', body: 'κείμενο',
    });
    expect(from).toHaveBeenCalledWith('contracts');
    expect(insert).toHaveBeenCalledWith({
      client_id: 'c1', template_id: 't1', title: 'Σύμβαση Web', body: 'κείμενο', status: 'draft',
    });
    expect(id).toBe('k1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('inserts a lead contract without a client', async () => {
    single.mockResolvedValue({ data: { id: 'k2' }, error: null });
    const { result } = renderHook(() => useCreateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    const id = await result.current.mutateAsync({
      client_id: null, lead_id: 'l1', template_id: null, title: 'Σύμβαση franchise', body: 'κείμενο',
    });
    expect(insert).toHaveBeenCalledWith({
      client_id: null, lead_id: 'l1', template_id: null,
      title: 'Σύμβαση franchise', body: 'κείμενο', status: 'draft',
    });
    expect(id).toBe('k2');
  });

  it('throws on insert error', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    const { result } = renderHook(() => useCreateContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      result.current.mutateAsync({ client_id: 'c1', template_id: null, title: 'x', body: 'y' }),
    ).rejects.toThrow('rls denied');
  });
});
