import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { sanitizeStorageFileName } from '@/lib/sanitizeStorageKey';

const MAX_BYTES = 25 * 1024 * 1024;

export type CommentAttachmentParent = { comment_id: string } | { task_comment_id: string };
type Vars = { parent: CommentAttachmentParent; file: File };

function parentKey(p: CommentAttachmentParent): { scope: 'comment' | 'task_comment'; id: string } {
  return 'comment_id' in p
    ? { scope: 'comment', id: p.comment_id }
    : { scope: 'task_comment', id: p.task_comment_id };
}

export function useUploadCommentAttachment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('comment_attachments', 'upload', async ({ parent, file }: Vars) => {
      if (file.size > MAX_BYTES) throw new Error('file_too_large');
      const userId = useAuthStore.getState().user?.id;
      if (!userId) throw new Error('not_authenticated');
      const { id } = parentKey(parent);
      // eslint-disable-next-line react-hooks/purity -- imperative mutationFn
      const path = `comment/${id}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;
      const { error: e1 } = await supabase.storage.from('attachments').upload(path, file, {
        contentType: file.type, cacheControl: '3600', upsert: false,
      });
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from('comment_attachments').insert({
        ...('comment_id' in parent ? { comment_id: parent.comment_id } : { task_comment_id: parent.task_comment_id }),
        storage_path: path, file_name: file.name, file_size: file.size,
        mime_type: file.type, uploaded_by: userId,
      });
      if (e2) throw new Error(e2.message);
    }),
    onSuccess: (_d, { parent }) => {
      const { scope, id } = parentKey(parent);
      void qc.invalidateQueries({ queryKey: queryKeys.commentAttachments(scope, id) });
    },
  });
}
