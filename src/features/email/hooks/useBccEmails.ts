import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';

/** Admin-only map message_pk -> bcc_emails. RLS enforces adminship; the
 *  isAdmin gate just skips a guaranteed-empty query for everyone else. */
export function useBccEmails(messageIds: string[]): Map<string, string> {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const key = [...messageIds].sort().join(',');
  const q = useQuery({
    queryKey: ['email-bcc', key] as const,
    enabled: isAdmin && messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_message_bcc' as never)
        .select('message_pk, bcc_emails')
        .in('message_pk', messageIds);
      if (error) throw new Error(error.message);
      return data as unknown as { message_pk: string; bcc_emails: string }[];
    },
  });
  return new Map((q.data ?? []).map((r) => [r.message_pk, r.bcc_emails]));
}
