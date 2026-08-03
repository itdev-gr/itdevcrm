import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// vi.mock is hoisted above the file body, so the mocks it references must be
// created via vi.hoisted (top-level consts would be read before init).
const { onMock, subscribeMock, removeChannelMock } = vi.hoisted(() => ({
  onMock: vi.fn().mockReturnThis(),
  subscribeMock: vi.fn().mockReturnThis(),
  removeChannelMock: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => ({ on: onMock, subscribe: subscribeMock })),
    removeChannel: removeChannelMock,
  },
}));
import { useDealPaymentsRealtime } from './useDealPaymentsRealtime';

describe('useDealPaymentsRealtime', () => {
  it('subscribes to deal_payments postgres_changes and cleans up on unmount', () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useDealPaymentsRealtime(), { wrapper });
    expect(onMock).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'deal_payments' }),
      expect.any(Function),
    );
    expect(subscribeMock).toHaveBeenCalled();
    unmount();
    expect(removeChannelMock).toHaveBeenCalled();
  });
});
