import { useEffect, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type Options = {
  /** ms to wait after the last change before saving */
  debounceMs?: number;
  /** turn the loop off (e.g. read-only after conversion) */
  enabled?: boolean;
};

/**
 * Watches a serializable value and calls `save(value)` whenever it changes.
 * Returns a status that the UI can render as a small "Saving…" / "Saved" /
 * "Save failed" indicator next to the form.
 */
export function useAutoSave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  { debounceMs = 800, enabled = true }: Options = {},
): AutoSaveStatus {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const lastSavedRef = useRef<string | null>(null);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!enabled) return;
    const serialized = JSON.stringify(value);
    // First render: stash the initial value without firing a save.
    if (lastSavedRef.current === null) {
      lastSavedRef.current = serialized;
      return;
    }
    if (serialized === lastSavedRef.current) return;

    const id = setTimeout(async () => {
      setStatus('saving');
      try {
        await saveRef.current(value);
        lastSavedRef.current = serialized;
        setStatus('saved');
      } catch (err) {
        console.error('autosave failed', err);
        setStatus('error');
      }
    }, debounceMs);

    return () => clearTimeout(id);
  }, [value, enabled, debounceMs]);

  // Auto-fade the "saved" pill back to idle after a moment.
  useEffect(() => {
    if (status !== 'saved') return;
    const id = setTimeout(() => setStatus('idle'), 1500);
    return () => clearTimeout(id);
  }, [status]);

  return status;
}

export function autoSaveLabel(status: AutoSaveStatus, lang: 'en' | 'el' = 'en'): string {
  if (lang === 'el') {
    return status === 'saving'
      ? 'Αποθήκευση…'
      : status === 'saved'
        ? '✓ Αποθηκεύτηκε'
        : status === 'error'
          ? 'Αποτυχία αποθήκευσης'
          : '';
  }
  return status === 'saving'
    ? 'Saving…'
    : status === 'saved'
      ? '✓ Saved'
      : status === 'error'
        ? 'Save failed'
        : '';
}
