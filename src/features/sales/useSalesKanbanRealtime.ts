import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useSalesKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    // Coalesce bursts: a bulk move (hundreds of lead UPDATEs in seconds) must
    // not refetch every loaded kanban page once per event — one invalidation
    // per window is enough for the board to catch up.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel('sales-kanban-leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          void qc.invalidateQueries({ queryKey: queryKeys.leads() });
        }, 1500);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [qc]);
}
