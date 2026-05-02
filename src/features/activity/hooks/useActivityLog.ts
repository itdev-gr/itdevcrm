import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ActivityRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  action: 'insert' | 'update' | 'delete';
  changes: unknown;
  created_at: string;
  user: { full_name: string; email: string } | null;
};

export function useActivityLog(entityType: string, entityId: string) {
  return useQuery({
    queryKey: queryKeys.activity(entityType, entityId),
    queryFn: async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, user:profiles!activity_log_user_id_fkey(full_name, email)')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ActivityRow[];
    },
    enabled: !!entityId,
  });
}
