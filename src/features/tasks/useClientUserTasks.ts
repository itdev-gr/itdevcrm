import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { userTaskToCard, type TaskCard, type TaskClientJoin } from './taskCard';

/** A client-linked user_task row, optionally carrying the joined client row. */
export type ClientUserTaskRow = UserTaskRow & { client?: TaskClientJoin | null };

/** Map raw client-linked user_tasks into TaskCards (all kind='user'). Pure. */
export function mapClientUserTasks(rows: ClientUserTaskRow[], meId: string): TaskCard[] {
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

/** Scope a client's user_tasks to a deal/job tab. Untargeted tasks (deal_id AND
 *  job_id null) are client-level → show everywhere; a task with a deal_id shows on
 *  that deal (its job-targeted tasks carry the parent deal_id too, so they appear on
 *  the deal as well); a task with a job_id shows on that job. Pure. */
export function filterUserTasksForSource(
  rows: ClientUserTaskRow[],
  source: { kind: 'deal' | 'job'; id: string },
): ClientUserTaskRow[] {
  return rows.filter((r) => {
    if (r.deal_id == null && r.job_id == null) return true; // client-level
    return source.kind === 'deal' ? r.deal_id === source.id : r.job_id === source.id;
  });
}

/** A client's personal (user_tasks) tasks, scoped to a deal/job tab and mapped to
 *  cards. Bounded by user_tasks RLS (owner/creator/admin). */
export function useClientUserTasks(
  clientId: string | undefined,
  meId: string,
  source: { kind: 'deal' | 'job'; id: string },
) {
  const qc = useQueryClient();
  const query = useQuery<TaskCard[]>({
    queryKey: [...queryKeys.clientUserTasks(clientId ?? ''), source.kind, source.id],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tasks')
        .select('*, client:clients(id, name)')
        .eq('client_id', clientId!)
        .order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      const scoped = filterUserTasksForSource((data ?? []) as unknown as ClientUserTaskRow[], source);
      return mapClientUserTasks(scoped, meId);
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
