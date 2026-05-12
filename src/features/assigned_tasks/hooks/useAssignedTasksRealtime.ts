import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useAssignedTasksRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('assigned_tasks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assigned_tasks' },
        () => {
          void qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
