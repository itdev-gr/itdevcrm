import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ClientSearchRow = { id: string; name: string; code: string | null };

/** Debounced-friendly client typeahead. Disabled until `term` has >= 2 chars. */
export function useClientSearch(term: string) {
  const q = term.trim();
  return useQuery<ClientSearchRow[]>({
    queryKey: queryKeys.clientSearch(q.toLowerCase()),
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const like = `%${q}%`;
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, code')
        .eq('archived', false)
        .or(`name.ilike.${like},code.ilike.${like}`)
        .limit(20)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientSearchRow[];
    },
  });
}
