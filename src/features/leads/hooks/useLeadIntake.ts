import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

export type LeadIntakeMatch = {
  match_type: 'lead' | 'deal_client' | 'queued';
  record_id: string;
  display_name: string;
  context: string | null;
  matched_field: 'email' | 'phone';
  matched_email: string | null;
  matched_phone: string | null;
};

export type LeadIntakeRow = Database['public']['Tables']['lead_intake']['Row'];

export function useLeadIntake() {
  return useQuery({
    queryKey: ['lead_intake', 'pending'],
    queryFn: async (): Promise<LeadIntakeRow[]> => {
      const { data, error } = await supabase
        .from('lead_intake')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadIntakeRow[];
    },
  });
}

export function useLeadIntakeCount() {
  return useQuery({
    queryKey: ['lead_intake', 'count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('lead_intake')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
