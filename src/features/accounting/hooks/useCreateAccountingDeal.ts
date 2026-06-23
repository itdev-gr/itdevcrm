import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { accountingCreateDeal } from '@/lib/rpc';
import type { CreateDealParams } from '../newDeal';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useCreateAccountingDeal() {
  const qc = useQueryClient();
  return useMutation<{ deal_id: string; code: string }, DefaultError, CreateDealParams>({
    mutationFn: captureMutation('accounting', 'create_deal', async (params: CreateDealParams) => {
      const r = await accountingCreateDeal(params);
      if (!r.ok) {
        const err = new Error(r.errors[0] ?? 'create_failed');
        (err as Error & { errors?: string[] }).errors = r.errors;
        throw err;
      }
      return { deal_id: r.deal_id, code: r.code };
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
    },
  });
}
