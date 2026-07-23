import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { upload, fromBucket, insert, from } = vi.hoisted(() => {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const fromBucket = vi.fn().mockReturnValue({ upload });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ insert });
  return { upload, fromBucket, insert, from };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: fromBucket }, from },
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'me' } }) },
}));

vi.mock('@/lib/sentry', () => ({
  Sentry: { captureException: vi.fn() },
}));

import { useUploadCommentAttachment } from './useUploadCommentAttachment';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function makeFile(size: number, type = 'image/png', name = 'σχέδιο (1).png') {
  return new File([new Uint8Array(size)], name, { type });
}

describe('useUploadCommentAttachment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a >25 MB file with file_too_large before any storage call', async () => {
    const { result } = renderHook(() => useUploadCommentAttachment(), {
      wrapper: ({ children }) => wrap(children),
    });
    const file = makeFile(25 * 1024 * 1024 + 1);
    await expect(
      result.current.mutateAsync({ parent: { comment_id: 'c1' }, file }),
    ).rejects.toThrow('file_too_large');
    expect(fromBucket).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('uploads to comment/<id>/... (sanitized) then inserts a row with the comment FK + uploaded_by', async () => {
    const { result } = renderHook(() => useUploadCommentAttachment(), {
      wrapper: ({ children }) => wrap(children),
    });
    const file = makeFile(1024);
    await act(async () => {
      await result.current.mutateAsync({ parent: { comment_id: 'c1' }, file });
    });

    expect(fromBucket).toHaveBeenCalledWith('attachments');
    const [path, body] = upload.mock.calls[0]!;
    expect(path).toMatch(/^comment\/c1\//);
    // sanitizeStorageFileName strips spaces/parens/Greek to underscores.
    expect(path).not.toMatch(/[ ()]/);
    expect(path).not.toMatch(/σ/);
    expect(body).toBe(file);

    expect(from).toHaveBeenCalledWith('comment_attachments');
    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({
      comment_id: 'c1',
      file_name: 'σχέδιο (1).png',
      file_size: 1024,
      mime_type: 'image/png',
      uploaded_by: 'me',
      storage_path: path,
    });
    expect(row).not.toHaveProperty('task_comment_id');
  });

  it('inserts task_comment_id when the parent is a task comment', async () => {
    const { result } = renderHook(() => useUploadCommentAttachment(), {
      wrapper: ({ children }) => wrap(children),
    });
    const file = makeFile(1024);
    await act(async () => {
      await result.current.mutateAsync({ parent: { task_comment_id: 't9' }, file });
    });
    const [path] = upload.mock.calls[0]!;
    expect(path).toMatch(/^comment\/t9\//);
    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({ task_comment_id: 't9', uploaded_by: 'me' });
    expect(row).not.toHaveProperty('comment_id');
  });
});
