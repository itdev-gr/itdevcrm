import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { buildBoardCards, type TaskCard } from '@/features/tasks/taskCard';

export function useLeadTasks(leadId: string, meId: string) {
  const query = useQuery<TaskCard[]>({
    queryKey: queryKeys.leadTasks(leadId),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*, client:clients(id, name)')
        .eq('lead_id', leadId)
        .order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return buildBoardCards((data ?? []) as unknown as UserTaskRow[], [], meId);
    },
  });
  return { cards: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
