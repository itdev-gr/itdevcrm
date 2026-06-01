import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useExpenseCategories } from './useExpenseCategories';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useExpenseCategories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches non-archived categories ordered by sort_order', async () => {
    order.mockResolvedValue({
      data: [
        { id: 'a', key: 'salaries', name_en: 'Salaries', name_el: 'Μισθοί', sort_order: 10 },
        { id: 'b', key: 'rent', name_en: 'Rent', name_el: 'Ενοίκιο', sort_order: 30 },
      ],
      error: null,
    });
    const { result } = renderHook(() => useExpenseCategories(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('expense_categories');
    expect(eq).toHaveBeenCalledWith('archived', false);
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].key).toBe('salaries');
  });
});
