import { useCallback, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';

/** Drag-and-drop + paste file input for the comment composers. Dropped files and
 *  pasted image files (e.g. screenshots) are handed to `onFiles`, which appends
 *  them to the composer's pending-attachment list — the same path the paperclip
 *  picker uses. No-op while `disabled` (i.e. a submit is in flight). */
export function useFileDropPaste(onFiles: (files: File[]) => void, disabled = false) {
  const [isDragging, setIsDragging] = useState(false);

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      if (e.dataTransfer.types?.includes('Files')) {
        e.preventDefault();
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: DragEvent) => {
    // Only clear when the pointer leaves the drop container itself, not a child.
    if (e.currentTarget === e.target) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      setIsDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) {
        e.preventDefault();
        onFiles(files);
      }
    },
    [disabled, onFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (disabled) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => f != null);
      // Don't preventDefault — a plain text paste must still work normally.
      if (files.length) onFiles(files);
    },
    [disabled, onFiles],
  );

  return {
    isDragging,
    dropZoneProps: { onDragOver, onDragEnter: onDragOver, onDragLeave, onDrop },
    onPaste,
  };
}
