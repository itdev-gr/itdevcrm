import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type UserTaskRow = Database['public']['Tables']['user_tasks']['Row'];

type Args = {
  start: Date;
  end: Date;
  /** null = admin view across all users; string = filter to that owner */
  ownerUserId: string | null;
};

export function useUserTasks({ start, end, ownerUserId }: Args) {
  const qc = useQueryClient();
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const query = useQuery({
    queryKey: queryKeys.userTasks(startIso, endIso, ownerUserId),
    queryFn: async (): Promise<UserTaskRow[]> => {
      let q = supabase
        .from('user_tasks')
        .select('*')
        .gte('due_at', startIso)
        .lt('due_at', endIso)
        .order('due_at', { ascending: true });
      if (ownerUserId) q = q.eq('user_id', ownerUserId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as UserTaskRow[];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`user-tasks-${startIso}-${endIso}-${ownerUserId ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_tasks' },
        () => {
          void qc.invalidateQueries({
            queryKey: queryKeys.userTasks(startIso, endIso, ownerUserId),
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, startIso, endIso, ownerUserId]);

  return query;
}
