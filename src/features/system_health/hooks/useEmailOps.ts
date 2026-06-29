import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type QueueEmail = {
  id: string;
  to_email: string;
  template_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

export type FailedEmail = {
  id: string;
  to_email: string;
  template_key: string;
  status: string;
  error: string | null;
  created_at: string;
};

// Queue: anything not yet successfully delivered (admin-read via RLS).
export function useEmailQueue(enabled: boolean) {
  return useQuery({
    queryKey: ['email-queue'] as const,
    enabled,
    queryFn: async (): Promise<QueueEmail[]> => {
      const { data, error } = await supabase
        .from('email_outbox')
        .select('id, to_email, template_key, status, attempts, last_error, created_at')
        .in('status', ['pending', 'sending', 'failed'])
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as QueueEmail[];
    },
    refetchInterval: 60_000,
  });
}

// Recent failures & bounces from the audit log (last 7 days).
export function useEmailFailures(enabled: boolean) {
  return useQuery({
    queryKey: ['email-failures'] as const,
    enabled,
    queryFn: async (): Promise<FailedEmail[]> => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('email_log')
        .select('id, to_email, template_key, status, error, created_at')
        .in('status', ['failed', 'bounced', 'complained'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as FailedEmail[];
    },
    refetchInterval: 60_000,
  });
}

function useEmailAction(rpc: 'email_outbox_retry' | 'email_outbox_cancel') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc(rpc as never, { p_id: id } as never);
      if (error) throw new Error(error.message);
      return data as { ok: boolean; error?: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-queue'] });
      void qc.invalidateQueries({ queryKey: ['email-health'] });
    },
  });
}

export const useRetryEmail = () => useEmailAction('email_outbox_retry');
export const useCancelEmail = () => useEmailAction('email_outbox_cancel');
