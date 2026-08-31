import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/fetchAllPages';

export type MeetingLead = {
  id: string;
  title: string;
  code: string | null;
  company_name: string | null;
  phone: string | null;
  owner_user_id: string | null;
  stage_id: string | null;
  scheduled_for: string;
};

/**
 * The Sales Tasks page's meeting reminders: every live lead sitting in UD
 * Scheduled with a booked meeting — from two weeks back (a passed meeting
 * still needs an outcome) to two weeks ahead. RLS scopes reps to their own
 * leads; admins see everyone's.
 */
export function useUpcomingMeetings() {
  return useQuery({
    queryKey: ['ud-upcoming-meetings'] as const,
    refetchInterval: 120_000,
    queryFn: async (): Promise<MeetingLead[]> => {
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const to = new Date();
      to.setDate(to.getDate() + 14);
      const rows = await fetchAllPages(() =>
        supabase
          .from('leads')
          .select(
            'id, title, code, company_name, phone, owner_user_id, stage_id, scheduled_for, stage:pipeline_stages!inner(code)',
          )
          .eq('archived', false)
          .is('converted_at', null)
          .eq('stage.code', 'ud_scheduled')
          .not('scheduled_for', 'is', null)
          .gte('scheduled_for', from.toISOString())
          .lte('scheduled_for', to.toISOString())
          .order('scheduled_for', { ascending: true })
          .order('id', { ascending: true }),
      );
      return rows as unknown as MeetingLead[];
    },
  });
}
