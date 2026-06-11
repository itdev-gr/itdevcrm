import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { select, update, from, invoke, getSession } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const invoke = vi.fn();
  const getSession = vi.fn();
  return { select, eq, update, from, invoke, getSession };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from, functions: { invoke }, auth: { getSession } },
}));

import { useSendContract } from './useSendContract';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

const input = {
  contractId: 'k1',
  contractNumber: 'CTR-202606-0001',
  title: 'Σύμβαση Web',
  to: 'client@acme.gr',
  clientName: 'Acme SA',
};

describe('useSendContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ url: 'https://signed' }) }));
    invoke.mockResolvedValue({ data: { status: 'sent' }, error: null });
    select.mockResolvedValue({ data: [{ id: 'k1' }], error: null });
  });

  it('regenerates the PDF, sends the email with the attachment, marks sent', async () => {
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync(input);

    expect(fetch).toHaveBeenCalledWith(
      '/api/contract-pdf?id=k1',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
    expect(invoke).toHaveBeenCalledWith('send-email', {
      body: {
        identity: 'sales',
        to: 'client@acme.gr',
        templateKey: 'contract_send',
        data: {
          client_name: 'Acme SA',
          contract_title: 'Σύμβαση Web',
          contract_number: 'CTR-202606-0001',
        },
        attachments: [
          { bucket: 'contract-pdfs', path: 'contracts/k1.pdf', filename: 'CTR-202606-0001.pdf' },
        ],
      },
    });
    expect(from).toHaveBeenCalledWith('contracts');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', sent_at: expect.any(String) }),
    );
  });

  it('surfaces the real error and does not mark sent when the email fails', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: { json: () => Promise.resolve({ status: 'failed', error: 'boom' }) },
      }),
    });
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync(input)).rejects.toThrow(/boom/);
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when the status update matches no rows (no silent success)', async () => {
    select.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync(input)).rejects.toThrow(/status/);
  });

  it('throws when PDF generation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('pdf err') }));
    const { result } = renderHook(() => useSendContract(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(result.current.mutateAsync(input)).rejects.toThrow(/PDF generation failed/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
