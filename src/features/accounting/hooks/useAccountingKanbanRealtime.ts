import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useAccountingKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    // Auto-roll recurring payments forward whenever an accounting user opens
    // the board. Server-side function is idempotent — only creates rows when
    // an existing recurring payment is within 7 days of expiry.
    void supabase.rpc('ensure_recurring_payments').then(() => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    });

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
