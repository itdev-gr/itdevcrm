import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

function useBreakMutation(op: 'start' | 'end') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('break', op, async (_vars: void) => {
      const { error } = await supabase.rpc(op === 'start' ? 'start_my_break' : 'end_my_break');
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.breakToday() }),
  });
}

export function useStartBreak() {
  return useBreakMutation('start');
}

export function useEndBreak() {
  return useBreakMutation('end');
}
