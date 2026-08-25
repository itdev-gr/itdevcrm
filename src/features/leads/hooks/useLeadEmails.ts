import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealEmailRow } from '@/features/deals/hooks/useDealEmails';

/** Automated emails sent for a lead, newest first, via lead_email_statuses.
 *  Leads have no realtime mirror in activity_log (that only fires for
 *  client-linked email_log rows), so this polls instead of subscribing. */
export function useLeadEmails(leadId: string) {
  return useQuery({
    queryKey: queryKeys.leadEmails(leadId),
    enabled: !!leadId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<DealEmailRow[]> => {
      // RPC not in generated types; cast the name + args (useDealEmails pattern).
      const { data, error } = await supabase.rpc(
        'lead_email_statuses' as never,
        { p_lead_id: leadId } as never,
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealEmailRow[];
    },
  });
}
