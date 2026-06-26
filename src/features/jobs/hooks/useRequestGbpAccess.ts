import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = { to: string; code: string };

export function useRequestGbpAccess() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Input>({
    mutationFn: captureMutation('local_seo', 'request_gbp_access', async (input: Input) => {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: 'accounting',
          to: input.to,
          templateKey: 'localseo_gbp_access',
          data: { code: input.code },
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
          // ignore — fall back to error.message
        }
        throw new Error(msg);
      }
      const status = (data as { status?: string; error?: string } | null)?.status;
      if (status !== 'sent' && status !== 'skipped') {
        throw new Error((data as { error?: string } | null)?.error ?? 'send failed');
      }
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['gbp-access-sent-map'] }),
  });
}
