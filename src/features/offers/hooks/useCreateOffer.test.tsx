import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { single, insert, from, getSession } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  const getSession = vi.fn();
  return { single, insert, from, getSession };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from, auth: { getSession } } }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_a: string, _b: string, fn: unknown) => fn,
}));

import { useCreateOffer } from './useCreateOffer';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

const base = {
  currency: 'EUR',
  discount_amount: 0,
  vat_percent: 24,
  validity_days: 14,
  notes: null,
  items: [],
  totals: { subtotal: 0, discountAmount: 0, taxable: 0, vatAmount: 0, total: 0 },
};

describe('useCreateOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'off-1' }, error: null });
  });

  it('stamps created_by from the session — the offer-view comment and the follow-up scheduler both read it', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } });
    const { result } = renderHook(() => useCreateOffer(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ ...base, client_id: 'c-1' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ created_by: 'u-1', client_id: 'c-1' }));
  });

  it('falls back to null rather than throwing when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useCreateOffer(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ ...base, lead_id: 'l-1' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ created_by: null }));
  });

  it('writes to `offers` and NOTHING else — an offer must not reach billing', async () => {
    // Owner, 2026-09-04: «όταν στέλνουν ένα νέο offer από το accounting δεν
    // πρέπει να επηρεάζονται οι υπηρεσίες που έχουμε στο billing μέσα, γιατί
    // είναι offer και δεν έχει μπει στο billing». It is true today; this test
    // is what makes it stay true.
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } });
    const { result } = renderHook(() => useCreateOffer(), {
      wrapper: ({ children }) => wrap(children),
    });
    await result.current.mutateAsync({ ...base, deal_id: 'd-1' });

    const tablesTouched = from.mock.calls.map((c) => c[0]);
    expect(tablesTouched).toEqual(['offers']);
    for (const forbidden of ['deals', 'jobs', 'deal_payments', 'deal_payment_lines']) {
      expect(tablesTouched).not.toContain(forbidden);
    }
  });
});
