import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

export function useExpensesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`expenses-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          void qc.invalidateQueries({ queryKey: ['expenses'] });
          void qc.invalidateQueries({ queryKey: ['expense'] });
          // Shared money-surface list — an inline subset here previously left
          // the MRR tile and dashboard trend stale on expense edits (report
          // audit 2026-09-09, finding 6j).
          invalidateFinancialReports(qc);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
