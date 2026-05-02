import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
  });
}
