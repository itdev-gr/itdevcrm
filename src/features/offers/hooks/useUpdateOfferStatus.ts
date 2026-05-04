import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Status = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export function useUpdateOfferStatus(offerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('offers', 'update_status', async (status: Status) => {
      const { error } = await supabase
        .from('offers')
        .update({
          status,
          sent_at: status === 'sent' ? new Date().toISOString() : null,
        })
        .eq('id', offerId);
      if (error) {
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.offer(offerId) });
      void qc.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}
