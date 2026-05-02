import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useSalesKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel('sales-kanban-leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.leads() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);
}
