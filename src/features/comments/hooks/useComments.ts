import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { CommentParentType } from '../commentChannels';

export type CommentRow = {
  id: string;
  parent_type: CommentParentType;
  parent_id: string;
  author_id: string;
  body: string;
  mentioned_user_ids: string[];
  reply_to_id: string | null;
  task_key: string | null;
  created_at: string;
  updated_at: string;
  author: { user_id: string; full_name: string; email: string } | null;
};

export function useComments(parentType: CommentParentType, parentId: string) {
  return useQuery({
    queryKey: queryKeys.comments(parentType, parentId),
    queryFn: async (): Promise<CommentRow[]> => {
      const { data, error } = await supabase
        .from('comments')
        .select(
          'id, parent_type, parent_id, author_id, body, mentioned_user_ids, reply_to_id, task_key, created_at, updated_at, author:profiles!comments_author_id_fkey(user_id, full_name, email)',
        )
        .eq('parent_type', parentType)
        .eq('parent_id', parentId)
        .eq('archived', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CommentRow[];
    },
    enabled: !!parentId,
  });
}
