import { useQuery } from '@tanstack/react-query';
import { coldLeadIds } from '@/lib/rpc';

/**
 * Given the lead-target ids visible in the intake queue, returns the subset in a
 * COLD stage (dead_end / not_interested / no_answer / constant_na) as a Set, so a
 * Meta re-submission matching one can be re-engaged on Release.
 */
export function useColdLeads(ids: string[]): Set<string> {
  const sorted = [...new Set(ids)].sort();
  const { data } = useQuery({
    queryKey: ['lead_cold_ids', sorted],
    queryFn: () => coldLeadIds(sorted),
    enabled: sorted.length > 0,
    staleTime: 30_000,
  });
  return new Set(data ?? []);
}
