import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type DealEmailRow = {
  id: string;
  to_email: string;
  template_key: string;
  status: string;
  /** Present on lead_email_statuses rows; 'personal' = sent via owner Gmail. */
  identity?: string;
  delivered_at: string | null;
  bounced_at: string | null;
  error: string | null;
  created_at: string;
  dedupe_key: string;
};

/** Emails sent for a deal (its own + its jobs' + its payments'), newest first,
 *  via the deal_email_statuses RPC. Live-updates by subscribing to the client's
 *  public activity_log, which mirrors every email_log insert/delivery/bounce. */
export function useDealEmails(dealId: string, clientId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.dealEmails(dealId),
    enabled: !!dealId,
    staleTime: 30_000,
    queryFn: async (): Promise<DealEmailRow[]> => {
      // RPC not in generated types; cast the name + args.
      const { data, error } = await supabase.rpc(
        'deal_email_statuses' as never,
        { p_deal_id: dealId } as never,
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealEmailRow[];
    },
  });

  useEffect(() => {
    if (!dealId || !clientId) return;
    const channel = supabase
      .channel(`deal-emails-${dealId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_log', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const nt = (payload.new as { entity_type?: string } | null)?.entity_type;
          const ot = (payload.old as { entity_type?: string } | null)?.entity_type;
          if (nt === 'email_log' || ot === 'email_log') {
            void qc.invalidateQueries({ queryKey: queryKeys.dealEmails(dealId) });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dealId, clientId, qc]);

  return query;
}
