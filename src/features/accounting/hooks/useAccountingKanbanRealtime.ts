import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useAccountingKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('accounting-kanban')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
