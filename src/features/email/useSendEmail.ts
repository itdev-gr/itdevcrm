import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type SendEmailVars = {
  identity: 'sales' | 'accounting' | 'internal' | 'personal';
  to: string;
  subject: string;
  body: string; // plain text; newlines become <br/> in html
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  dedupeKey?: string | undefined;
};

export function useSendEmail() {
  return useMutation({
    mutationFn: async (vars: SendEmailVars) => {
      const html = vars.body.replace(/\n/g, '<br/>');
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: vars.identity,
          to: vars.to,
          templateKey: 'custom',
          data: { subject: vars.subject, html, text: vars.body },
          dedupeKey: vars.dedupeKey ?? null,
          ...(vars.cc && vars.cc.length > 0 ? { cc: vars.cc } : {}),
          ...(vars.bcc && vars.bcc.length > 0 ? { bcc: vars.bcc } : {}),
        },
      });
      if (error) throw new Error(error.message);
      if ((data as { status?: string })?.status === 'failed') {
        throw new Error((data as { error?: string }).error ?? 'send failed');
      }
      return data;
    },
  });
}
