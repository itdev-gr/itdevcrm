import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { EMAIL_COLS, type EmailMessageRow } from './useEmailThreads';

export type InboxCategory = 'sales' | 'accounting' | 'support' | 'other' | 'personal';

export type InboxItem = EmailMessageRow & {
  captured_from_user_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  unread: boolean;
  unfiled: boolean;
  mine: boolean;
  category: InboxCategory;
};

const INBOX_COLS = `${EMAIL_COLS}, client_id, deal_id, captured_from_user_id`;

const CATEGORY_BY_MAILBOX: Record<string, InboxCategory> = {
  'sales@itdev.gr': 'sales',
  'accounting@itdev.gr': 'accounting',
  'support@itdev.gr': 'support',
};

function categorize(capturedFrom: string | null, mailboxByUser: Map<string, string>): InboxCategory {
  if (!capturedFrom) return 'other';
  const mailbox = mailboxByUser.get(capturedFrom);
  if (!mailbox) return 'personal';
  return CATEGORY_BY_MAILBOX[mailbox] ?? 'other';
}

// Single shared visibility rule: non-admins never see mail from a mailbox we
// couldn't classify (category 'other'). Every admin-aware view — the inbox
// page's item list/counts and the topbar badge/unreadCount below — must
// filter through this one predicate so they can never disagree.
export function isInboxItemVisible(item: Pick<InboxItem, 'category'>, isAdmin: boolean): boolean {
  return isAdmin || item.category !== 'other';
}

export function useEmailInbox() {
  const myEmail = (useAuthStore((s) => s.user?.email) ?? '').toLowerCase();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const query = useQuery({
    queryKey: queryKeys.emailInbox(),
    queryFn: async () => {
      const [msgs, reads, mailboxes] = await Promise.all([
        supabase
          .from('email_messages')
          .select(INBOX_COLS)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(300),
        // Bridge: email_message_reads is not yet in generated supabase.ts; drop `as never` after next `npm run types:gen`.
        supabase.from('email_message_reads' as never).select('message_pk'),
        supabase.from('shared_mailboxes' as never).select('user_id, email'),
      ]);
      if (msgs.error) throw new Error(msgs.error.message);
      if (reads.error) throw new Error(reads.error.message);
      if (mailboxes.error) throw new Error(mailboxes.error.message);
      const readRows = (reads.data ?? []) as unknown as { message_pk: string }[];
      const mailboxRows = (mailboxes.data ?? []) as unknown as { user_id: string; email: string }[];
      const mailboxByUser = new Map(mailboxRows.map((r) => [r.user_id, r.email.toLowerCase()]));
      return {
        rows: msgs.data ?? [],
        readPks: new Set(readRows.map((r) => r.message_pk)),
        mailboxByUser,
      };
    },
    refetchInterval: 60_000,
  });
  const rows = (query.data?.rows ?? []) as unknown as (EmailMessageRow & {
    client_id: string | null; deal_id: string | null; captured_from_user_id: string | null;
  })[];
  const readPks = query.data?.readPks ?? new Set<string>();
  const mailboxByUser = query.data?.mailboxByUser ?? new Map<string, string>();
  const items: InboxItem[] = rows.map((r) => ({
    ...r,
    unread: !readPks.has(r.id),
    unfiled: !r.client_id && !r.lead_id && !r.job_id && !r.deal_id,
    mine: myEmail !== '' && r.to_email.toLowerCase().includes(myEmail),
    category: categorize(r.captured_from_user_id, mailboxByUser),
  }));
  const unreadCount = items.filter((i) => i.unread && isInboxItemVisible(i, isAdmin)).length;
  return { ...query, items, unreadCount };
}

export function useMarkEmailRead() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  async function insert(pks: string[]) {
    if (!userId || pks.length === 0) return;
    const { error } = await supabase
      // Bridge: email_message_reads is not yet in generated supabase.ts; drop `as never` after next `npm run types:gen`.
      .from('email_message_reads' as never)
      .upsert(
        pks.map((message_pk) => ({ message_pk, user_id: userId })) as never,
        { onConflict: 'message_pk,user_id', ignoreDuplicates: true },
      );
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
