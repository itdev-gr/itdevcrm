import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * The `comments` table is polymorphic. A DEAL entity's comment files can hang
 * off any of the four deal channels plus the plain deal thread, all keyed by
 * the deal id; lead/client map to a single parent_type. Task-comment files
 * (task_comment_id) never surface here — they have no entity to attach to.
 */
const DEAL_TYPES = ['deal', 'deal_dev', 'deal_seo', 'deal_ads', 'deal_social'];

export type EntityCommentFile = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
};

export function useEntityCommentFiles(
  parentType: 'deal' | 'lead' | 'client',
  parentId: string,
) {
  const types = parentType === 'deal' ? DEAL_TYPES : [parentType];
  return useQuery({
    queryKey: ['entity-comment-files', parentType, parentId] as const,
    enabled: !!parentId,
    queryFn: async (): Promise<EntityCommentFile[]> => {
      const { data, error } = await supabase
        .from('comment_attachments')
        .select(
          'id, storage_path, file_name, mime_type, comments!inner(parent_type, parent_id, archived)',
        )
        .in('comments.parent_type', types)
        .eq('comments.parent_id', parentId)
        .eq('comments.archived', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: (r as { id: string }).id,
        storage_path: (r as { storage_path: string }).storage_path,
        file_name: (r as { file_name: string }).file_name,
        mime_type: (r as { mime_type: string | null }).mime_type,
      }));
    },
  });
}
