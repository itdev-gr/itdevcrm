import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeadEmails } from './useLeadEmails';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useLeadEmails', () => {
  beforeEach(() => rpc.mockReset());

  it('fetches lead_email_statuses for the lead', async () => {
    rpc.mockResolvedValue({ data: [{ id: '1', template_key: 'lead_welcome', status: 'delivered' }], error: null });
    const { result } = renderHook(() => useLeadEmails('lead-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('lead_email_statuses', { p_lead_id: 'lead-1' });
    expect(result.current.data).toHaveLength(1);
  });

  it('surfaces RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useLeadEmails('lead-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});
