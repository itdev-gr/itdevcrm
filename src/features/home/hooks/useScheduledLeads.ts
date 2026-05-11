import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ScheduledLead = {
  id: string;
  code: string | null;
  title: string;
  scheduled_for: string;
  owner_user_id: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  company_name: string | null;
  stage: { code: string; display_names: { en?: string; el?: string } | null } | null;
};

type Args = {
  start: Date;
  end: Date;
  /** null = all (admin view), string = filter to that owner_user_id */
  ownerUserId: string | null;
};

export function useScheduledLeads({ start, end, ownerUserId }: Args) {
  const qc = useQueryClient();
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const query = useQuery({
    queryKey: queryKeys.scheduledLeads(startIso, endIso, ownerUserId),
    queryFn: async (): Promise<ScheduledLead[]> => {
      let q = supabase
        .from('leads')
        .select(
          'id, code, title, scheduled_for, owner_user_id, contact_first_name, contact_last_name, company_name, stage:pipeline_stages!leads_stage_id_fkey(code, display_names)',
        )
        .eq('archived', false)
        .gte('scheduled_for', startIso)
        .lt('scheduled_for', endIso)
        .order('scheduled_for', { ascending: true });

      if (ownerUserId) q = q.eq('owner_user_id', ownerUserId);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ScheduledLead[];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`scheduled-leads-${startIso}-${endIso}-${ownerUserId ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        () => {
          void qc.invalidateQueries({
            queryKey: queryKeys.scheduledLeads(startIso, endIso, ownerUserId),
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
