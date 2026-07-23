import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ClipboardEvent, DragEvent } from 'react';

import { useFileDropPaste } from './useFileDropPaste';

const mkFile = (name: string) => new File(['x'], name, { type: 'image/png' });

describe('useFileDropPaste', () => {
  it('onDrop hands all dropped files to onFiles once and prevents default', () => {
    const onFiles = vi.fn();
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useFileDropPaste(onFiles));

    const file1 = mkFile('a.png');
    const file2 = mkFile('b.png');
    act(() => {
      result.current.dropZoneProps.onDrop({
        dataTransfer: { files: [file1, file2] },
        preventDefault,
      } as unknown as DragEvent);
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([file1, file2]);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('onPaste passes only pasted file items (not string items) to onFiles', () => {
    const onFiles = vi.fn();
    const imgFile = mkFile('shot.png');
    const { result } = renderHook(() => useFileDropPaste(onFiles));

    act(() => {
      result.current.onPaste({
        clipboardData: {
          items: [
            { kind: 'file', getAsFile: () => imgFile },
            { kind: 'string', getAsFile: () => null },
          ],
        },
      } as unknown as ClipboardEvent);
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([imgFile]);
  });

  it('is a no-op while disabled (neither drop nor paste fires onFiles)', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropPaste(onFiles, true));

    act(() => {
      result.current.dropZoneProps.onDrop({
        dataTransfer: { files: [mkFile('a.png')] },
        preventDefault: vi.fn(),
      } as unknown as DragEvent);
      result.current.onPaste({
        clipboardData: { items: [{ kind: 'file', getAsFile: () => mkFile('b.png') }] },
      } as unknown as ClipboardEvent);
    });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it('onDragOver sets isDragging only when the drag carries files', () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropPaste(onFiles));

    act(() => {
      result.current.dropZoneProps.onDragOver({
        dataTransfer: { types: ['Files'] },
        preventDefault: vi.fn(),
      } as unknown as DragEvent);
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      result.current.dropZoneProps.onDragLeave({
        currentTarget: 1,
        target: 1,
      } as unknown as DragEvent);
    });
    expect(result.current.isDragging).toBe(false);

    act(() => {
      result.current.dropZoneProps.onDragOver({
        dataTransfer: { types: ['text/plain'] },
        preventDefault: vi.fn(),
      } as unknown as DragEvent);
    });
    expect(result.current.isDragging).toBe(false);
  });
});
