import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CommentRow = {
  id: string;
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
  author_id: string;
  body: string;
  mentioned_user_ids: string[];
  created_at: string;
  author: { user_id: string; full_name: string; email: string } | null;
};

export function useComments(parentType: 'client' | 'deal' | 'job', parentId: string) {
  return useQuery({
    queryKey: queryKeys.comments(parentType, parentId),
    queryFn: async (): Promise<CommentRow[]> => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(user_id, full_name, email)')
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
