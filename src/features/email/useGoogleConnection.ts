import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type GoogleStatusRow = { google_email: string; connected: boolean };

export function useGoogleConnection(targetUserId?: string) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['google-connection'] as const,
    queryFn: async (): Promise<{ connected: boolean; email: string | null }> => {
      // my_google_status is a security-definer function added in migration 20260602000005;
      // the generated types predate it, so we cast through unknown.
      const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: GoogleStatusRow[] | null; error: { message: string } | null }>)('my_google_status');
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : null;
      return { connected: !!row?.connected, email: row?.google_email ?? null };
    },
  });
  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-oauth', { body: { action: 'start', ...(targetUserId ? { target_user_id: targetUserId } : {}) } });
      if (error) throw new Error(error.message);
      const url = (data as { url?: string })?.url;
      if (url) window.location.href = url;
    },
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('google-oauth', { body: { action: 'disconnect', ...(targetUserId ? { target_user_id: targetUserId } : {}) } });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['google-connection'] }),
  });
  return {
    connected: status.data?.connected ?? false,
    email: status.data?.email ?? null,
    isLoading: status.isLoading,
    connect: connect.mutate,
    disconnect: disconnect.mutate,
  };
}
