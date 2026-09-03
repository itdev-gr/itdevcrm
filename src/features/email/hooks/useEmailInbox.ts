import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { EMAIL_COLS, type EmailMessageRow } from './useEmailThreads';

export type InboxItem = EmailMessageRow & {
  captured_from_user_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  unread: boolean;
  unfiled: boolean;
  mine: boolean;
};

const INBOX_COLS = `${EMAIL_COLS}, client_id, deal_id, captured_from_user_id`;

export function useEmailInbox() {
  const myEmail = (useAuthStore((s) => s.user?.email) ?? '').toLowerCase();
  const query = useQuery({
    queryKey: queryKeys.emailInbox(),
    queryFn: async () => {
      const [msgs, reads] = await Promise.all([
        supabase
          .from('email_messages')
          .select(INBOX_COLS)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(300),
        supabase.from('email_message_reads').select('message_pk'),
      ]);
      if (msgs.error) throw new Error(msgs.error.message);
      if (reads.error) throw new Error(reads.error.message);
      return { rows: msgs.data ?? [], readPks: new Set((reads.data ?? []).map((r) => r.message_pk as string)) };
    },
    refetchInterval: 60_000,
  });
  const rows = (query.data?.rows ?? []) as unknown as (EmailMessageRow & {
    client_id: string | null; deal_id: string | null; captured_from_user_id: string | null;
  })[];
  const readPks = query.data?.readPks ?? new Set<string>();
  const items: InboxItem[] = rows.map((r) => ({
    ...r,
    unread: !readPks.has(r.id),
    unfiled: !r.client_id && !r.lead_id && !r.job_id && !r.deal_id,
    mine: myEmail !== '' && r.to_email.toLowerCase().includes(myEmail),
  }));
  return { ...query, items, unreadCount: items.filter((i) => i.unread).length };
}

export function useMarkEmailRead() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  async function insert(pks: string[]) {
    if (!userId || pks.length === 0) return;
    const { error } = await supabase
      .from('email_message_reads')
      .upsert(pks.map((message_pk) => ({ message_pk, user_id: userId })), { onConflict: 'message_pk,user_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
  }
  return {
    markRead: (pk: string) => insert([pk]),
    markAllRead: (pks: string[]) => insert(pks),
  };
}

export function useEmailInboxRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    // Unique topic per mount — supabase-js reuses channels per identical topic
    // and a second .on() after subscribe() throws (deal 000121, 2026-09-03).
    const channel = supabase
      .channel(`email-inbox-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_messages' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
