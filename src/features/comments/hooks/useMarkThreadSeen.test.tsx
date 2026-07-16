import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: 'me' } }),
}));

import { useMarkThreadSeen } from './useMarkThreadSeen';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useMarkThreadSeen', () => {
  beforeEach(() => {
    upserts.length = 0;
  });

  it('upserts my last_seen row for a deal channel once the thread has loaded', async () => {
    renderHook(() => useMarkThreadSeen('deal_ads', 'D1', '2026-07-16T10:00:00Z'), { wrapper });
    await waitFor(() => expect(upserts).toHaveLength(1));
    const first = upserts[0];
    expect(first?.table).toBe('comment_thread_reads');
    expect(first?.row).toMatchObject({
      user_id: 'me',
      parent_type: 'deal_ads',
      parent_id: 'D1',
    });
    expect(typeof first?.row.last_seen_at).toBe('string');
  });

  it('does nothing while the thread is still loading (newestKey null)', async () => {
    renderHook(() => useMarkThreadSeen('deal_ads', 'D1', null), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(upserts).toHaveLength(0);
  });

  it('ignores non-deal threads (lead / client / job pages)', async () => {
    renderHook(() => useMarkThreadSeen('lead', 'L1', 'x'), { wrapper });
    renderHook(() => useMarkThreadSeen('job', 'J1', 'x'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(upserts).toHaveLength(0);
  });

  it('re-marks when new comments arrive while the tab stays open', async () => {
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) => useMarkThreadSeen('deal', 'D1', key),
      { wrapper, initialProps: { key: 'a' as string | null } },
    );
    await waitFor(() => expect(upserts).toHaveLength(1));
    rerender({ key: 'b' });
    await waitFor(() => expect(upserts).toHaveLength(2));
  });
});
