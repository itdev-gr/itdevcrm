import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ServiceType } from './useJobs';

export function useJobsRealtime(serviceType: ServiceType) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`jobs-${serviceType}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `service_type=eq.${serviceType}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.jobsByService(serviceType) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, serviceType]);
}
