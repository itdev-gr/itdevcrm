import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { ASSIGNED_TASK_SELECT, type AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';
import { buildBoardCards, type TaskCard } from '@/features/tasks/taskCard';

export function useClientTasks(clientId: string, meId: string) {
  const query = useQuery<TaskCard[]>({
    queryKey: queryKeys.clientTasks(clientId),
    enabled: !!clientId,
    queryFn: async () => {
      const [u, a] = await Promise.all([
        supabase.from('user_tasks').select('*').eq('client_id', clientId).order('due_at', { ascending: true }),
        supabase.from('assigned_tasks').select(ASSIGNED_TASK_SELECT).eq('client_id', clientId).order('created_at', { ascending: false }),
      ]);
      if (u.error) throw new Error(u.error.message);
      if (a.error) throw new Error(a.error.message);
      return buildBoardCards(
        (u.data ?? []) as UserTaskRow[],
        (a.data ?? []) as unknown as AssignedTaskRow[],
        meId,
      );
    },
  });
  return { cards: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
