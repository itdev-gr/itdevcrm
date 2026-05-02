import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateMonthlyInvoices } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useGenerateMonthlyInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      const result = await generateMonthlyInvoices(period);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'generate_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return { period: result.period, count: result.invoices_generated };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.monthlyInvoices() });
    },
  });
}
