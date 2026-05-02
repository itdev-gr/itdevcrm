import { useMutation, useQueryClient } from '@tanstack/react-query';
import { blockClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useBlockClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, reason }: { clientId: string; reason: string }) => {
      const result = await blockClient(clientId, reason);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'block_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.block_id;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clientBlock(vars.clientId) });
    },
  });
}
