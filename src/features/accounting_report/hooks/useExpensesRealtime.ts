import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
          void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
          void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
