import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAiConversations, useSendChatMessage } from './useAiChat';

const invoke = vi.fn();
const fromChain = {
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => fromChain,
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useAiConversations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the caller-owned conversations', async () => {
    fromChain.limit.mockResolvedValue({
      data: [{ id: 'c1', title: 'Ερώτηση', created_at: 'x', updated_at: 'y' }],
      error: null,
    });
    const { result } = renderHook(() => useAiConversations(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.id).toBe('c1');
  });
});

describe('useSendChatMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes accounting-chat with the message and returns the reply', async () => {
    invoke.mockResolvedValue({
      data: { conversation_id: 'c1', reply: 'Όλα καλά', tools_used: ['client_360'] },
      error: null,
    });
    const { result } = renderHook(() => useSendChatMessage(), { wrapper });
    const res = await result.current.mutateAsync({ conversationId: null, message: 'τι γίνεται;' });
    expect(invoke).toHaveBeenCalledWith('accounting-chat', {
      body: { conversation_id: undefined, message: 'τι γίνεται;' },
    });
    expect(res.reply).toBe('Όλα καλά');
  });

  it('surfaces function errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'forbidden', context: undefined } });
    const { result } = renderHook(() => useSendChatMessage(), { wrapper });
    await expect(
      result.current.mutateAsync({ conversationId: null, message: 'x' }),
    ).rejects.toThrow('forbidden');
  });
});
