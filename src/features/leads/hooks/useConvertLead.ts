import { useMutation, useQueryClient } from '@tanstack/react-query';
import { convertLeadToClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type ConvertResult = { leadId: string; clientId: string; dealId: string };

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation<ConvertResult, Error, string>({
    mutationFn: captureMutation('leads', 'convert', async (leadId: string): Promise<ConvertResult> => {
      const result = await convertLeadToClient(leadId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'convert_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return { leadId: result.lead_id, clientId: result.client_id, dealId: result.deal_id };
    }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      void qc.invalidateQueries({ queryKey: queryKeys.lead(result.leadId) });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    },
  });
}
