import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Status = 'draft' | 'sent' | 'paid' | 'cancelled';

export function useUpdateProFormaStatus(proFormaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('pro_formas', 'update_status', async (status: Status) => {
      const { error } = await supabase
        .from('pro_formas')
        .update({
          status,
          ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
          ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}),
        })
        .eq('id', proFormaId);
      if (error) {
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.proForma(proFormaId) });
      void qc.invalidateQueries({ queryKey: ['pro-formas'] });
    },
  });
}
