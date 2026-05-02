import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CommentRow = {
  id: string;
  parent_type: 'client' | 'deal' | 'job' | 'lead';
  parent_id: string;
  author_id: string;
  body: string;
  mentioned_user_ids: string[];
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
  author: { user_id: string; full_name: string; email: string } | null;
};

export function useComments(parentType: 'client' | 'deal' | 'job' | 'lead', parentId: string) {
  return useQuery({
    queryKey: queryKeys.comments(parentType, parentId),
    queryFn: async (): Promise<CommentRow[]> => {
      const { data, error } = await supabase
        .from('comments')
        .select(
          'id, parent_type, parent_id, author_id, body, mentioned_user_ids, reply_to_id, created_at, updated_at, author:profiles!comments_author_id_fkey(user_id, full_name, email)',
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
