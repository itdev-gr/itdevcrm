import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { userTaskToCard, type TaskCard } from './taskCard';

/** Map raw client-linked user_tasks into TaskCards (all kind='user'). Pure. */
export function mapClientUserTasks(rows: UserTaskRow[], meId: string): TaskCard[] {
  return rows.map((r) => userTaskToCard(r, meId));
}

/** Split cards into open (not resolved) and resolved. Pure. */
export function partitionClientTasks(cards: TaskCard[]): {
  open: TaskCard[];
  resolved: TaskCard[];
} {
  return {
    open: cards.filter((c) => !c.resolved),
    resolved: cards.filter((c) => c.resolved),
  };
}

/** A client's personal (user_tasks) tasks, mapped to cards, for surfacing on the
 *  deal/job Tasks tabs. Bounded by user_tasks RLS (owner/creator/admin). */
export function useClientUserTasks(clientId: string | undefined, meId: string) {
  const qc = useQueryClient();
  const query = useQuery<TaskCard[]>({
    queryKey: queryKeys.clientUserTasks(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*')
        .eq('client_id', clientId!)
        .order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return mapClientUserTasks((data ?? []) as UserTaskRow[], meId);
    },
  });

  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`client-user-tasks-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_tasks' },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.clientUserTasks(clientId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, clientId]);

  return { cards: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
