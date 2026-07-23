import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { from, select, inFn, eq, order } = vi.hoisted(() => {
  const order = vi.fn();
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    order,
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  return { from, select: chain.select, inFn: chain.in, eq: chain.eq, order };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useEntityCommentFiles } from './useEntityCommentFiles';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useEntityCommentFiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idle (no query) when parentId is empty', () => {
    const { result } = renderHook(() => useEntityCommentFiles('deal', ''), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
  });

  it('queries comment_attachments joined to the 5 deal parent_types + deal id, non-archived, shaped as GalleryFile', async () => {
    order.mockResolvedValue({
      data: [
        {
          id: 'a1',
          storage_path: 'comment/c1/1-plan.png',
          file_name: 'plan.png',
          mime_type: 'image/png',
          comments: { parent_type: 'deal_dev', parent_id: 'd1', archived: false },
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useEntityCommentFiles('deal', 'd1'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(from).toHaveBeenCalledWith('comment_attachments');
    expect(select).toHaveBeenCalledWith(
      'id, storage_path, file_name, mime_type, comments!inner(parent_type, parent_id, archived)',
    );
    expect(inFn).toHaveBeenCalledWith('comments.parent_type', [
      'deal',
      'deal_dev',
      'deal_seo',
      'deal_ads',
      'deal_social',
    ]);
    expect(eq).toHaveBeenCalledWith('comments.parent_id', 'd1');
    expect(eq).toHaveBeenCalledWith('comments.archived', false);
    // No embedded join leaks into the returned GalleryFile shape.
    expect(result.current.data).toEqual([
      {
        id: 'a1',
        storage_path: 'comment/c1/1-plan.png',
        file_name: 'plan.png',
        mime_type: 'image/png',
      },
    ]);
  });

  it('queries a single parent_type for lead / client entities', async () => {
    order.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useEntityCommentFiles('lead', 'l1'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(inFn).toHaveBeenCalledWith('comments.parent_type', ['lead']);
    expect(eq).toHaveBeenCalledWith('comments.parent_id', 'l1');
    expect(eq).toHaveBeenCalledWith('comments.archived', false);
  });
});
