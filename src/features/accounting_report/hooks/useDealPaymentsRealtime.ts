import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

// deal_payments is already in the realtime publication (the accounting kanban
// listens to it); the Report/Dashboard just never subscribed. Mirrors the
// channel/subscribe/unsubscribe idiom of useExpensesRealtime.
export function useDealPaymentsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`deal-payments-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deal_payments' },
        () => {
          invalidateFinancialReports(qc);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
