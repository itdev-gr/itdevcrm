import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';
import { htmlToText } from './htmlToText';

export type SendEmailVars = {
  identity: 'sales' | 'accounting' | 'internal' | 'personal';
  to: string;
  subject: string;
  body: string; // HTML from the rich-text editor
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  dedupeKey?: string | undefined;
  attachments?: { bucket: string; path: string; filename: string; mimeType?: string }[] | undefined;
};

export function useSendEmail() {
  return useMutation({
    mutationFn: async (vars: SendEmailVars) => {
      const html = sanitizeEmailHtml(vars.body);
      const text = htmlToText(vars.body);
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: vars.identity,
          to: vars.to,
          templateKey: 'custom',
          data: { subject: vars.subject, html, text },
          dedupeKey: vars.dedupeKey ?? null,
          ...(vars.cc && vars.cc.length > 0 ? { cc: vars.cc } : {}),
          ...(vars.bcc && vars.bcc.length > 0 ? { bcc: vars.bcc } : {}),
          ...(vars.attachments && vars.attachments.length ? { attachments: vars.attachments } : {}),
        },
      });
      if (error) {
        // The edge function's JSON body carries the real error code; the
        // FunctionsHttpError message is just "non-2xx status code".
        let msg = error.message;
        try {
          const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
          if (ctx?.json) {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch { /* keep the generic message */ }
        throw new Error(msg);
      }
      if ((data as { status?: string })?.status === 'failed') {
        throw new Error((data as { error?: string }).error ?? 'send failed');
      }
      return data;
    },
  });
}
