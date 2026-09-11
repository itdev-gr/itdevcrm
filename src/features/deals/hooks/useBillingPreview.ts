import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * What a billing action is about to do, fetched BEFORE the user confirms it.
 *
 * The numbers come from `job_billing_action_preview` / `deal_close_preview`,
 * which run the exact same filters the action itself runs afterwards — so the
 * preview cannot drift from the result. Until 2026-09-11 the only figure any
 * dialog showed was the End dialog's unpaid total; pause said "unpaid payments
 * will be cancelled" without ever saying how many or how much, even though
 * `job_pause_billing` returns `payments_cancelled` once it is too late to
 * matter.
 *
 * Both hooks are gated on `enabled` so nothing is fetched until the dialog
 * actually opens — the same lazy pattern as `useJobUnpaidTotal`.
 */
export type JobBillingPreview = {
  /** Unpaid RECURRING invoices this action will cancel. */
  cancel_count: number;
  cancel_gross: number;
  /** Everything still unpaid, recurring or not — what stays owed. */
  unpaid_gross: number;
  /** Pause/resume act on the whole deal+service chain, not just this card. */
  chain_jobs: number;
  monthly_value: number;
};

export type DealClosePreview = {
  jobs_to_close: number;
  /** Services whose billing the close will switch off (Bug 2 fix, 20260911160000). */
  services_billing_stopped: number;
  monthly_value_stopped: number;
  open_payments_count: number;
  open_payments_gross: number;
};

type Rpc<T> = ({ ok: true } & T) | { ok: false; errors?: string[] };

function unwrap<T>(data: unknown): T | null {
  const r = data as Rpc<T> | null;
  if (!r || r.ok !== true) return null;
  return r as unknown as T;
}

export function useJobBillingPreview(jobId: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ['job-billing-preview', jobId] as const,
    enabled: enabled && !!jobId,
    staleTime: 15_000,
    queryFn: async (): Promise<JobBillingPreview | null> => {
      const { data, error } = await supabase.rpc('job_billing_action_preview' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      return unwrap<JobBillingPreview>(data);
    },
  });
  // `null` means "not known yet" — never collapsed to zero, so a dialog can
  // stay silent rather than promise "0 invoices will be cancelled".
  return { preview: q.data ?? null, isLoading: q.isLoading };
}

export function useDealClosePreview(dealId: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ['deal-close-preview', dealId] as const,
    enabled: enabled && !!dealId,
    staleTime: 15_000,
    queryFn: async (): Promise<DealClosePreview | null> => {
      const { data, error } = await supabase.rpc('deal_close_preview' as never, {
        p_deal_id: dealId,
      } as never);
      if (error) throw new Error(error.message);
      return unwrap<DealClosePreview>(data);
    },
  });
  return { preview: q.data ?? null, isLoading: q.isLoading };
}
