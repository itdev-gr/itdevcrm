import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow } from './useJobs';

export function useJobsForDeal(dealId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.jobsForDeal(dealId),
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('deal_id', dealId)
        .eq('archived', false)
        // Group by service, then a stable order within each service so the
        // deal's job list doesn't reshuffle on edits (newest-created first,
        // id as tie-breaker).
        .order('service_type')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
    enabled: !!dealId,
  });

  useEffect(() => {
    if (!dealId) return;
    const channel = supabase
      .channel(`jobs-for-deal-${dealId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `deal_id=eq.${dealId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.jobsForDeal(dealId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dealId, qc]);

  return query;
}
