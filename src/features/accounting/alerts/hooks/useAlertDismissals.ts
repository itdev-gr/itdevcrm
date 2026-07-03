import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

// `.bind(supabase)` is required: supabase-js's `from()`/`rpc()` read `this.rest`,
// so capturing them bare loses the binding and throws "Cannot read properties of
// undefined (reading 'rest')" before any request is sent (known repo footgun).
const from = supabase.from.bind(supabase);
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type DismissAlertInput = {
  check_key: string;
  subject_id: string;
  signature: string;
  note?: string;
};

/** Dismiss a single integrity alert; hides it from the open list + count. */
export function useDismissAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: DismissAlertInput) => {
      const { error } = await rpc('dismiss_integrity_alert', {
        p_check_key: v.check_key,
        p_subject_id: v.subject_id,
        p_signature: v.signature,
        p_note: v.note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrity-alerts'] });
      void qc.invalidateQueries({ queryKey: ['integrity-alerts-count'] });
    },
  });
}

/** Undo a dismissal by its id; the alert reappears if still active. */
export function useUndismissAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc('undismiss_integrity_alert', { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrity-alerts'] });
      void qc.invalidateQueries({ queryKey: ['integrity-alerts-count'] });
      void qc.invalidateQueries({ queryKey: ['integrity-alert-dismissals'] });
    },
  });
}

export type DismissalRow = Database['public']['Tables']['integrity_alert_dismissals']['Row'];

/** All recorded dismissals, most-recent first (for the "Dismissed" tab). */
export function useDismissedAlerts(): { data: DismissalRow[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['integrity-alert-dismissals'],
    queryFn: async (): Promise<DismissalRow[]> => {
      const { data, error } = await from('integrity_alert_dismissals')
        .select('*')
        .order('dismissed_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as DismissalRow[];
    },
  });
  return { data: query.data ?? [], isLoading: query.isLoading };
}
