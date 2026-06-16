import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type RpcResult = { data: number | null; error: { message: string } | null };
const rpc = supabase.rpc as unknown as (fn: string) => Promise<RpcResult>;

export function useDistributeUnassigned() {
  const qc = useQueryClient();
  return useMutation<number, DefaultError, void>({
    mutationFn: captureMutation('leads', 'distribute', async () => {
      const { data, error } = await rpc('distribute_unassigned_leads');
      if (error) throw new Error(error.message);
      return data ?? 0;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
