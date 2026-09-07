import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

// The send-campaign edge function's test-send mode
// (supabase/functions/send-campaign/index.ts, `body.test`) — NOT modified
// here, only invoked. It responds `{ok:true,resendId}` or
// `{ok:false,error}` on a real (deployed) call, but as of this task it is
// NOT deployed yet: `supabase.functions.invoke` will fail before it ever
// gets a response (network/404-shaped FunctionsFetchError). StepReview must
// treat that the same as any other failure — a translated message, never a
// crash.
export type TestSendCampaignResult = { ok: true; resendId?: string } | { ok: false; error?: string };

type InvokeError = {
  message: string;
  context?: { json?: () => Promise<{ error?: string }> };
};

/** supabase-js's FunctionsHttpError carries the actual response body (with
 *  our own `{error: '...'}` shape) on `.context`; a FunctionsFetchError
 *  (network failure / function not deployed) has no such body. Falls back to
 *  the error's own message — still readable, never throws further. */
async function extractInvokeErrorMessage(error: InvokeError): Promise<string> {
  try {
    const body = await error.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    // Not a JSON body (or no context at all) — fall through to error.message.
  }
  return error.message;
}

export function useTestSendCampaign() {
  return useMutation<TestSendCampaignResult, Error, { campaignId: string; to: string }>({
    mutationFn: captureMutation('email_marketing', 'send_campaign_test', async ({ campaignId, to }) => {
      const { data, error } = await supabase.functions.invoke('send-campaign', {
        body: { campaignId, test: true, to },
      });
      if (error) {
        throw new Error(await extractInvokeErrorMessage(error as InvokeError));
      }
      return data as TestSendCampaignResult;
    }),
  });
}
