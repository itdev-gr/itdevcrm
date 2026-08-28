import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealEmailRow } from '@/features/deals/hooks/useDealEmails';

export type JobEmailRow = DealEmailRow;

/** Client-facing automated emails relevant to a job (its own + service-relevant
 *  deal-level ones like welcome and payment reminders), newest first, via the
 *  job_email_statuses RPC. Live-updates by subscribing to the client's public
 *  activity_log, which mirrors every email_log insert/delivery/bounce. */
export function useJobEmails(jobId: string, clientId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.jobEmails(jobId),
    enabled: !!jobId,
    staleTime: 30_000,
    queryFn: async (): Promise<JobEmailRow[]> => {
      // RPC not in generated types; cast the name + args.
      const { data, error } = await supabase.rpc(
        'job_email_statuses' as never,
        { p_job_id: jobId } as never,
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobEmailRow[];
    },
  });

  useEffect(() => {
    if (!jobId || !clientId) return;
    const channel = supabase
      .channel(`job-emails-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_log', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const nt = (payload.new as { entity_type?: string } | null)?.entity_type;
          const ot = (payload.old as { entity_type?: string } | null)?.entity_type;
          if (nt === 'email_log' || ot === 'email_log') {
            void qc.invalidateQueries({ queryKey: queryKeys.jobEmails(jobId) });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, clientId, qc]);

  return query;
}
