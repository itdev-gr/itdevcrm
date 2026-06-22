import { useQuery } from '@tanstack/react-query';
import { deadEndLeadIds } from '@/lib/rpc';

/**
 * Given the lead-target ids visible in the intake queue, returns the subset that
 * are dead-end / not-interested as a Set, so the merge picker can mark them and
 * warn before merging (a dead-end merge discards the new submission).
 */
export function useDeadEndLeads(ids: string[]): Set<string> {
  const sorted = [...new Set(ids)].sort();
  const { data } = useQuery({
    queryKey: ['lead_dead_end_ids', sorted],
    queryFn: () => deadEndLeadIds(sorted),
    enabled: sorted.length > 0,
    staleTime: 30_000,
  });
  return new Set(data ?? []);
}
