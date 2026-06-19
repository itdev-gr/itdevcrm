import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useAccountingKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    // Recurring payments roll forward via the daily pg_cron (ensure_recurring_payments).
    // We intentionally do NOT call that cron on board mount: it is a write-on-read that
    // previously amplified a duplicate-payment bug. The board only subscribes to live
    // changes below.
    const channel = supabase
      .channel('accounting-kanban')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deal_payments' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
