import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { CommentAttachmentParent } from './useUploadCommentAttachment';

export type CommentAttachmentRow = {
  id: string; storage_path: string; file_name: string;
  mime_type: string | null; file_size: number | null; uploaded_by: string;
};

const COLS = 'id, storage_path, file_name, mime_type, file_size, uploaded_by';

export function useCommentAttachments(parent: CommentAttachmentParent | null) {
  const scope = parent && 'comment_id' in parent ? 'comment' : 'task_comment';
  const id = parent ? ('comment_id' in parent ? parent.comment_id : parent.task_comment_id) : '';
  const column = 'comment_id' in (parent ?? {}) ? 'comment_id' : 'task_comment_id';
  return useQuery({
    queryKey: queryKeys.commentAttachments(scope, id),
    enabled: !!id,
    queryFn: async (): Promise<CommentAttachmentRow[]> => {
      const { data, error } = await supabase
        .from('comment_attachments').select(COLS).eq(column, id)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CommentAttachmentRow[];
    },
  });
}
