import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { upload, fromBucket, single, select, eq, update, from } = vi.hoisted(() => {
  const upload = vi.fn().mockResolvedValue({ data: { path: 'p' }, error: null });
  const fromBucket = vi.fn().mockReturnValue({ upload });
  const single = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { upload, fromBucket, single, select, eq, update, from };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: fromBucket }, from },
}));

import { useUploadReceipt, MAX_BYTES, ALLOWED_MIME } from './useUploadReceipt';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

function makeFile(size: number, type = 'application/pdf', name = 'r.pdf') {
  return new File([new Uint8Array(size)], name, { type });
}

describe('useUploadReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads to expense-receipts/{id}/... and updates receipt_path', async () => {
    const { result } = renderHook(() => useUploadReceipt(), {
      wrapper: ({ children }) => wrap(children),
    });
    const file = makeFile(1024);
    await act(async () => {
      await result.current.mutateAsync({ expenseId: 'e1', file });
    });
    expect(fromBucket).toHaveBeenCalledWith('expense-receipts');
    const [path, body] = upload.mock.calls[0];
    expect(path).toMatch(/^e1\//);
    expect(body).toBe(file);
    expect(update).toHaveBeenCalledWith({ receipt_path: expect.stringMatching(/^e1\//) });
    expect(eq).toHaveBeenCalledWith('id', 'e1');
  });

  it('rejects oversized files before uploading', async () => {
    const { result } = renderHook(() => useUploadReceipt(), {
      wrapper: ({ children }) => wrap(children),
    });
    const file = makeFile(MAX_BYTES + 1);
    await expect(
      result.current.mutateAsync({ expenseId: 'e1', file }),
    ).rejects.toThrow(/larger than 10 MB/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects wrong MIME types before uploading', async () => {
    const { result } = renderHook(() => useUploadReceipt(), {
      wrapper: ({ children }) => wrap(children),
    });
    const file = makeFile(1024, 'text/plain', 'r.txt');
    await expect(
      result.current.mutateAsync({ expenseId: 'e1', file }),
    ).rejects.toThrow(/file type/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it('exports the allowlist for the form to read', () => {
    expect(ALLOWED_MIME).toContain('application/pdf');
    expect(ALLOWED_MIME).toContain('image/png');
  });
});
