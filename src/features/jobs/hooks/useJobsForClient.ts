import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow } from './useJobs';

export function useJobsForClient(clientId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.jobsForClient(clientId),
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .eq('client_id', clientId)
        .eq('archived', false)
        // Stable, fixed order (newest-created first) so the list doesn't
        // reshuffle when a job is edited; id breaks created_at ties.
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
    enabled: !!clientId,
  });

  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`jobs-for-client-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `client_id=eq.${clientId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.jobsForClient(clientId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clientId, qc]);

  return query;
}
