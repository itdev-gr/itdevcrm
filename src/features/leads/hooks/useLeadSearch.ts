import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type LeadSearchRow = {
  id: string;
  title: string;
  code: string | null;
  company_name: string | null;
};

/** Debounced-friendly lead typeahead. Disabled until `term` has >= 2 chars.
 *  Leads RLS scopes results (reps own-only; view_all/admins see all). */
export function useLeadSearch(term: string) {
  const q = term.trim();
  return useQuery<LeadSearchRow[]>({
    queryKey: queryKeys.leadSearch(q.toLowerCase()),
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const like = `%${q}%`;
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, code, company_name')
        .eq('archived', false)
        .or(
          `title.ilike.${like},company_name.ilike.${like},code.ilike.${like},business_profile_name.ilike.${like}`,
        )
        .limit(20)
        .order('title', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadSearchRow[];
    },
  });
}

/** Resolve a lead's display title by id (edit mode only has lead_id). */
export function useLeadTitle(leadId: string | null) {
  return useQuery<string | null>({
    queryKey: ['lead-title', leadId],
    enabled: !!leadId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('title')
        .eq('id', leadId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.title ?? null;
    },
  });
}
