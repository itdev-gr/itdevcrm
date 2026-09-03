import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

/** Every outcome send_lead_noshow_email can report. The RPC returns a status
 *  string rather than throwing, so the button can say WHY nothing went out
 *  instead of failing silently. */
export type NoShowResult =
  | 'sent'
  | 'already_sent'
  | 'forbidden'
  | 'not_found'
  | 'archived'
  | 'not_scheduled'
  | 'not_due'
  | 'no_email'
  | 'opted_out'
  | 'automations_off';

/** Manual «Δεν απάντησε» send. The cron no longer emails no-shows: only the rep
 *  knows whether the appointment was genuinely missed. Delivery goes through
 *  the normal outbox, i.e. from the lead owner's own Gmail. */
export function useSendNoShowEmail(leadId: string) {
  const qc = useQueryClient();
  return useMutation<NoShowResult, DefaultError, void>({
    mutationFn: captureMutation('leads', 'noshow_email', async (): Promise<NoShowResult> => {
      const { data, error } = await supabase.rpc('send_lead_noshow_email' as never, {
        p_lead_id: leadId,
      } as never);
      if (error) throw new Error(error.message);
      return (data as unknown as NoShowResult) ?? 'not_found';
    }),
    onSuccess: () => {
      // The outbox drains within ~2 min; refresh the lead's email list so the
      // send shows up there too.
      void qc.invalidateQueries({ queryKey: queryKeys.leadEmails(leadId) });
    },
  });
}
