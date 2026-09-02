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
    // Unique topic per mount: the page and the CloseDealDialog can both mount
    // this hook for the same deal, and supabase-js returns the SAME channel
    // for an identical topic — the second `.on()` after `subscribe()` throws
    // and crashes the route (same pattern as useExpensesRealtime).
    const channel = supabase
      .channel(`jobs-for-deal-${dealId}-${crypto.randomUUID()}`)
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
