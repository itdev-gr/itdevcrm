import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Resolve one open `data_integrity_alerts` row (`resolve_integrity_alert`
 *  RPC — admin-only, the DB re-checks). */
export function useResolveCronAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.rpc('resolve_integrity_alert', { p_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cron-integrity-alerts'] });
      void qc.invalidateQueries({ queryKey: ['integrity-alerts-count'] });
    },
  });
}

/** Resolve every open row of one `kind` at once — the group-resolve "broom"
 *  (`resolve_integrity_alerts_kind` RPC — admin-only). Returns the number of
 *  rows resolved. Deliberately never called programmatically by this task
 *  against the live 348-row backlog: it exists so the owner can clear it. */
export function useResolveCronAlertsKind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: string): Promise<number> => {
      const { data, error } = await supabase.rpc('resolve_integrity_alerts_kind', { p_kind: kind });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cron-integrity-alerts'] });
      void qc.invalidateQueries({ queryKey: ['integrity-alerts-count'] });
    },
  });
}
