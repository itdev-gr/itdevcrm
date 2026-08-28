import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { sanitizeStorageFileName } from '@/lib/sanitizeStorageKey';

// Per-file cap matches the Gmail-path total guard (fetchMimeAttachments): a
// single file above the total could never send anyway.
const MAX_FILE = 18 * 1024 * 1024;
const MAX_TOTAL = 18 * 1024 * 1024;

export type EmailAttachmentRef = {
  // Buckets accepted by send-email's validateAttachmentRefs.
  bucket: 'attachments' | 'offer-pdfs' | 'contract-pdfs';
  path: string;
  filename: string;
  mimeType: string;
  bytes: number;
};

// External refs point at durable objects owned elsewhere (e.g. the offer PDF
// in offer-pdfs) — the composer must never delete those from storage.
type StagedRef = EmailAttachmentRef & { external?: boolean };

export function useEmailAttachmentStaging(initial: EmailAttachmentRef[] = []) {
  const stagingId = useRef(crypto.randomUUID());
  const [refs, setRefs] = useState<StagedRef[]>(() => initial.map((r) => ({ ...r, external: true })));
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    setBusy(true);
    // Accumulate within THIS batch too (not just against committed refs), so
    // dropping several files at once can't slip past the total guard.
    let running = refs.reduce((n, r) => n + r.bytes, 0);
    try {
      for (const file of files) {
        if (file.size > MAX_FILE) { setError('file_too_large'); continue; }
        if (running + file.size > MAX_TOTAL) { setError('attachments_too_large'); continue; }
        setPending((p) => [...p, file]);
        const path = `email/${stagingId.current}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;
        const { error: e } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
        setPending((p) => p.filter((f) => f !== file));
        if (e) { setError('upload_failed'); continue; }
        running += file.size;
        setRefs((r) => [...r, { bucket: 'attachments', path, filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: file.size }]);
      }
    } finally {
      setBusy(false);
    }
  }, [refs]);

  const remove = useCallback((index: number) => {
    setError(null);
    setRefs((r) => {
      const ref = r[index];
      if (ref && !ref.external) void supabase.storage.from(ref.bucket).remove([ref.path]);
      return r.filter((_, i) => i !== index);
    });
  }, []);

  const cleanup = useCallback(async () => {
    const paths = refs.filter((r) => !r.external).map((r) => r.path);
    if (paths.length) await supabase.storage.from('attachments').remove(paths);
    setRefs([]);
  }, [refs]);

  return { refs, pending, busy, error, addFiles, remove, cleanup };
}
