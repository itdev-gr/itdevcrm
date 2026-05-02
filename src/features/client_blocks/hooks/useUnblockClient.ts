import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unblockClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useUnblockClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const result = await unblockClient(clientId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'unblock_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.block_id;
    },
    onSuccess: (_d, clientId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clientBlock(clientId) });
    },
  });
}
