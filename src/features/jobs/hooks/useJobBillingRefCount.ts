import { useQuery } from '@tanstack/react-query';
import { jobBillingRefCount } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Count of invoice/payment lines referencing this job — drives the delete-confirm
 * warning. `enabled` is wired to "is the confirm dialog open" so we only fetch on demand.
 */
export function useJobBillingRefCount(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jobBillingRefCount(jobId),
    queryFn: () => jobBillingRefCount(jobId),
    enabled: enabled && !!jobId,
    staleTime: 30_000,
  });
}
