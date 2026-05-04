import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { unblockClient } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useUnblockClient() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, string>({
    mutationFn: captureMutation('client_blocks', 'unblock', async (clientId: string) => {
      const result = await unblockClient(clientId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'unblock_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.block_id;
    }),
    onSuccess: (_d, clientId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clientBlock(clientId) });
    },
  });
}
