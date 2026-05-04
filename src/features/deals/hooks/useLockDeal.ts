import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { lockDeal } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useLockDeal() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, string>({
    mutationFn: captureMutation('deals', 'lock', async (dealId: string) => {
      const result = await lockDeal(dealId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'lock_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.deal_id;
    }),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(id) });
    },
  });
}
