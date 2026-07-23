import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { CommentAttachmentParent } from './useUploadCommentAttachment';

type Vars = { id: string; storage_path: string; parent: CommentAttachmentParent };

export function useDeleteCommentAttachment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('comment_attachments', 'delete', async ({ id, storage_path }: Vars) => {
      // Remove the object FIRST (surface its error) — never orphan a row over a file.
      const { error: e1 } = await supabase.storage.from('attachments').remove([storage_path]);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from('comment_attachments').delete().eq('id', id);
      if (e2) throw new Error(e2.message);
    }),
    onSuccess: (_d, { parent }) => {
      const scope = 'comment_id' in parent ? 'comment' : 'task_comment';
      const pid = 'comment_id' in parent ? parent.comment_id : parent.task_comment_id;
      void qc.invalidateQueries({ queryKey: queryKeys.commentAttachments(scope, pid) });
    },
  });
}
