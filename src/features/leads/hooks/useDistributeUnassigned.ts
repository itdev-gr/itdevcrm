import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type RpcResult = { data: number | null; error: { message: string } | null };
// `.bind(supabase)` is required: supabase-js's `rpc()` reads `this.rest`, so a
// bare `supabase.rpc` reference loses its binding and crashes with
// "Cannot read properties of undefined (reading 'rest')".
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string) => Promise<RpcResult>;

export function useDistributeUnassigned() {
  const qc = useQueryClient();
  return useMutation<number, DefaultError, void>({
    mutationFn: captureMutation('leads', 'distribute', async () => {
      const { data, error } = await rpc('distribute_unassigned_leads');
      if (error) throw new Error(error.message);
      return data ?? 0;
    }),
    // Return the promise so `mutateAsync` resolves only after the leads list
    // has refetched — otherwise the caller's success alert blocks the thread
    // while the table still shows the pre-distribution (stale) count.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.leads() }),
  });
}
