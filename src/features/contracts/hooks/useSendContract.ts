import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = {
  contractId: string;
  contractNumber: string;
  title: string;
  to: string;
  clientName: string;
};

export function useSendContract() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Input>({
    mutationFn: captureMutation('contracts', 'send', async (input: Input) => {
      // 1. Regenerate the PDF so the attachment matches the saved text.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/contract-pdf?id=${encodeURIComponent(input.contractId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PDF generation failed (${res.status}): ${text}`);
      }

      // 2. Email it via send-email with the storage-backed attachment.
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: 'sales',
          to: input.to,
          templateKey: 'contract_send',
          data: {
            client_name: input.clientName,
            contract_title: input.title,
            contract_number: input.contractNumber,
          },
          attachments: [
            {
              bucket: 'contract-pdfs',
              path: `contracts/${input.contractId}.pdf`,
              filename: `${input.contractNumber}.pdf`,
            },
          ],
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const ctx = error.context as { json?: () => Promise<{ error?: string }> } | undefined;
          if (ctx?.json) {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const status = (data as { status?: string; error?: string } | null)?.status;
      if (status !== 'sent' && status !== 'skipped') {
        throw new Error((data as { error?: string } | null)?.error ?? 'send failed');
      }

      // 3. Mark the contract as sent — verify a row was actually updated
      // (RLS can silently match 0 rows for staff without edit permission).
      const { data: updated, error: updErr } = await supabase
        .from('contracts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', input.contractId)
        .select('id');
      if (updErr) throw new Error(updErr.message);
      if (!updated || updated.length === 0) {
        throw new Error(
          'Email sent, but updating the contract status failed (no permission?) — check the contract status.',
        );
      }
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
