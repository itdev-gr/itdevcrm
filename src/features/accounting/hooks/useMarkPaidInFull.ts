import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { markPaidInFull } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

export function useMarkPaidInFull() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, string>({
    mutationFn: captureMutation('accounting', 'mark_paid_in_full', async (dealId: string) => {
      const result = await markPaidInFull(dealId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'mark_paid_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.deal_id;
    }),
    onSuccess: (_dealId, dealId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      invalidateFinancialReports(qc);
    },
  });
}
