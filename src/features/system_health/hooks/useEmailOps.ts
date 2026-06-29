import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Resolved recipient (client OR lead) for an email, when determinable.
export type Recipient = {
  recipient_kind: 'client' | 'lead' | null;
  recipient_id: string | null;
  recipient_name: string | null;
};

export type QueueEmail = Recipient & {
  id: string;
  to_email: string;
  template_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

export type FailedEmail = Recipient & {
  id: string;
  to_email: string;
  template_key: string;
  status: string;
  error: string | null;
  created_at: string;
};

// Queue: anything not yet successfully delivered, with its recipient resolved
// (admin-gated RPC; resolves client by id/email/deal, else lead by email).
export function useEmailQueue(enabled: boolean) {
  return useQuery({
    queryKey: ['email-queue'] as const,
    enabled,
    queryFn: async (): Promise<QueueEmail[]> => {
      const { data, error } = await supabase.rpc('email_queue_rows' as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as QueueEmail[];
    },
    refetchInterval: 60_000,
  });
}

// Recent failures & bounces (last 7 days), with recipient resolved.
export function useEmailFailures(enabled: boolean) {
  return useQuery({
    queryKey: ['email-failures'] as const,
    enabled,
    queryFn: async (): Promise<FailedEmail[]> => {
      const { data, error } = await supabase.rpc('email_failure_rows' as never);
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
