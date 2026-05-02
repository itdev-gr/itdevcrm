import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type AttachmentRow = {
  id: string;
  parent_type: 'client' | 'deal' | 'job';
  parent_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  kind: string | null;
  created_at: string;
};

export function useAttachments(parentType: 'client' | 'deal' | 'job', parentId: string) {
  return useQuery({
    queryKey: queryKeys.attachments(parentType, parentId),
    queryFn: async (): Promise<AttachmentRow[]> => {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('parent_type', parentType)
        .eq('parent_id', parentId)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AttachmentRow[];
    },
    enabled: !!parentId,
  });
}
