import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildTaskCountMaps } from '../serviceTaskMatch';

type Maps = { byDeal: Record<string, number>; byJob: Record<string, number> };

/** Open-task counts for the current service board: byDeal (department-matched deal
 *  tasks) + byJob (job-scoped tasks). One cached query shared by all cards on a board.
 *  RLS-limited — counts only what the viewer can see (admins: all), consistent with
 *  the Tasks tab. */
export function useServiceTaskCounts(serviceGroupId: string | null): Maps {
  const { data } = useQuery<Maps>({
    queryKey: ['service-task-counts', serviceGroupId ?? 'none'],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('assigned_tasks')
        .select('deal_id, job_id, department_group_id')
        .eq('status', 'open');
      q = serviceGroupId
        ? q.or(`department_group_id.eq.${serviceGroupId},job_id.not.is.null`)
        : q.not('job_id', 'is', null);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return buildTaskCountMaps(
        (data ?? []) as { deal_id: string | null; job_id: string | null; department_group_id: string | null }[],
        serviceGroupId,
      );
    },
  });
  return data ?? { byDeal: {}, byJob: {} };
}
