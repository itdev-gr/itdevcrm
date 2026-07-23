import { renderHook, act } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { upload, remove, fromBucket } = vi.hoisted(() => {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const fromBucket = vi.fn().mockReturnValue({ upload, remove });
  return { upload, remove, fromBucket };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: fromBucket } },
}));

import { useEmailAttachmentStaging } from './useEmailAttachmentStaging';

/** Build a File that reports `bytes` for `.size` without allocating the buffer. */
function fileOfSize(bytes: number, name = 'σχέδιο (1).png', type = 'image/png') {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

describe('useEmailAttachmentStaging', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads to email/<id>/... (sanitized) and records a ref with mimeType/bytes', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());
    const file = fileOfSize(1024);

    await act(async () => {
      await result.current.addFiles([file]);
    });

    expect(fromBucket).toHaveBeenCalledWith('attachments');
    const [path, body, opts] = upload.mock.calls[0]!;
    expect(path).toMatch(/^email\//);
    // sanitizeStorageFileName strips spaces/parens/Greek to underscores.
    expect(path).not.toMatch(/[ ()]/);
    expect(path).not.toMatch(/σ/);
    expect(body).toBe(file);
    expect(opts).toMatchObject({ contentType: 'image/png', upsert: false });

    expect(result.current.refs).toHaveLength(1);
    expect(result.current.refs[0]).toMatchObject({
      bucket: 'attachments',
      path,
      filename: 'σχέδιο (1).png',
      mimeType: 'image/png',
      bytes: 1024,
    });
    expect(result.current.error).toBeNull();
  });

  it('falls back to application/octet-stream when the file has no type', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());
    const file = fileOfSize(10, 'x.bin', '');

    await act(async () => {
      await result.current.addFiles([file]);
    });

    expect(result.current.refs[0]!.mimeType).toBe('application/octet-stream');
  });

  it('rejects a >25 MB file with file_too_large and uploads nothing', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());
    const file = fileOfSize(25 * 1024 * 1024 + 1);

    await act(async () => {
      await result.current.addFiles([file]);
    });

    expect(result.current.error).toBe('file_too_large');
    expect(upload).not.toHaveBeenCalled();
    expect(result.current.refs).toHaveLength(0);
  });

  it('sets attachments_too_large when total exceeds 18 MB and does not add the file', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());

    await act(async () => {
      await result.current.addFiles([fileOfSize(10 * 1024 * 1024, 'a.png')]);
    });
    expect(result.current.refs).toHaveLength(1);

    await act(async () => {
      await result.current.addFiles([fileOfSize(10 * 1024 * 1024, 'b.png')]);
    });

    expect(result.current.error).toBe('attachments_too_large');
    expect(result.current.refs).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('accumulates within a single multi-file batch (rejects the file that trips 18 MB)', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());

    await act(async () => {
      await result.current.addFiles([
        fileOfSize(12 * 1024 * 1024, 'a.png'),
        fileOfSize(12 * 1024 * 1024, 'b.png'),
      ]);
    });

    expect(result.current.refs).toHaveLength(1);
    expect(result.current.error).toBe('attachments_too_large');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('remove(0) deletes the storage object and drops the ref', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());

    await act(async () => {
      await result.current.addFiles([fileOfSize(1024)]);
    });
    const path = result.current.refs[0]!.path;

    act(() => {
      result.current.remove(0);
    });

    expect(remove).toHaveBeenCalledWith([path]);
    expect(result.current.refs).toHaveLength(0);
  });

  it('cleanup() removes all staged paths and clears refs', async () => {
    const { result } = renderHook(() => useEmailAttachmentStaging());

    await act(async () => {
      await result.current.addFiles([fileOfSize(1024, 'a.png')]);
    });
    await act(async () => {
      await result.current.addFiles([fileOfSize(1024, 'b.png')]);
    });
    const paths = result.current.refs.map((r) => r.path);
    expect(paths).toHaveLength(2);

    await act(async () => {
      await result.current.cleanup();
    });

    expect(remove).toHaveBeenCalledWith(paths);
    expect(result.current.refs).toHaveLength(0);
  });
});
