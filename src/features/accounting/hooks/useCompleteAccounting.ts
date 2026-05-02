import { useMutation, useQueryClient } from '@tanstack/react-query';
import { completeAccounting } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useCompleteAccounting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const result = await completeAccounting(dealId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'complete_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.deal_id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    },
  });
}
