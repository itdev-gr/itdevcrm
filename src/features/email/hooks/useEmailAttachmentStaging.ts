import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { sanitizeStorageFileName } from '@/lib/sanitizeStorageKey';

const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 18 * 1024 * 1024;

export type EmailAttachmentRef = { bucket: 'attachments'; path: string; filename: string; mimeType: string; bytes: number };

export function useEmailAttachmentStaging() {
  const stagingId = useRef(crypto.randomUUID());
  const [refs, setRefs] = useState<EmailAttachmentRef[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    for (const file of files) {
      if (file.size > MAX_FILE) { setError('file_too_large'); continue; }
      const total = refs.reduce((n, r) => n + r.bytes, 0) + file.size;
      if (total > MAX_TOTAL) { setError('attachments_too_large'); continue; }
      setBusy(true);
      setPending((p) => [...p, file]);
      const path = `email/${stagingId.current}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;
      const { error: e } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
      setPending((p) => p.filter((f) => f !== file));
      setBusy(false);
      if (e) { setError(e.message); continue; }
      setRefs((r) => [...r, { bucket: 'attachments', path, filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: file.size }]);
    }
  }, [refs]);

  const remove = useCallback((index: number) => {
    setRefs((r) => {
      const ref = r[index];
      if (ref) void supabase.storage.from('attachments').remove([ref.path]);
      return r.filter((_, i) => i !== index);
    });
  }, []);

  const clear = useCallback(() => setRefs([]), []);
  const cleanup = useCallback(async () => {
    const paths = refs.map((r) => r.path);
    if (paths.length) await supabase.storage.from('attachments').remove(paths);
    setRefs([]);
  }, [refs]);

  return { refs, pending, busy, error, addFiles, remove, clear, cleanup };
}
