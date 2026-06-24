import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { sanitizeStorageFileName } from '@/lib/sanitizeStorageKey';

const MAX_BYTES = 25 * 1024 * 1024;

type Vars = {
  parent_type: 'client' | 'deal' | 'job' | 'lead';
  parent_id: string;
  file: File;
  kind?: 'contract' | 'invoice' | 'other' | 'svc_local' | 'svc_web' | 'svc_webdev';
};

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('attachments', 'upload', async (vars: Vars) => {
      if (vars.file.size > MAX_BYTES) throw new Error('file_too_large');
      const userId = useAuthStore.getState().user?.id;
      if (!userId) throw new Error('not_authenticated');
      // Sanitise the filename for the storage key — Supabase Storage rejects
      // non-ASCII keys (e.g. Greek invoice names) with "Invalid key". The real
      // name is preserved below in the file_name column for display/download.
      // eslint-disable-next-line react-hooks/purity -- mutationFn body runs imperatively, not during render
      const path = `${vars.parent_type}/${vars.parent_id}/${Date.now()}-${sanitizeStorageFileName(vars.file.name)}`;
      const { error: e1 } = await supabase.storage.from('attachments').upload(path, vars.file, {
        contentType: vars.file.type,
        cacheControl: '3600',
        upsert: false,
      });
      if (e1) throw new Error(e1.message);

      const { error: e2 } = await supabase.from('attachments').insert({
        parent_type: vars.parent_type,
        parent_id: vars.parent_id,
        storage_path: path,
        file_name: vars.file.name,
        file_size: vars.file.size,
        mime_type: vars.file.type,
        uploaded_by: userId,
        kind: vars.kind ?? 'other',
      });
      if (e2) throw new Error(e2.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.attachments(vars.parent_type, vars.parent_id),
      });
    },
  });
}
