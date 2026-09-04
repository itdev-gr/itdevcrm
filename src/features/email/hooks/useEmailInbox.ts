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
  /** Cleared from the queue — for the whole team (shared mailbox) or just for me. */
  dismissed: boolean;
  mine: boolean;
  category: InboxCategory;
};

const INBOX_COLS = `${EMAIL_COLS}, client_id, deal_id, captured_from_user_id`;

// The topbar badge only needs to COUNT. It used to run the full inbox query —
// 300 rows including every subject, snippet and body — on every page in the
// app, which is how one page view ended up making 21 email_messages requests,
// the slowest taking 52s, with the page's own queries starving behind them.
// Two ids per row are enough to apply the same read/dismissed/visibility rules.
const BADGE_COLS = 'id, captured_from_user_id';

const BADGE_STALE_MS = 60_000;
// gmail-sync writes continuously (a sweep every 2 minutes, plus backfills), and
// every INSERT used to invalidate the inbox immediately. That is what produced
// the request pile-up — so coalesce the storm into at most one refetch per window.
const REALTIME_COALESCE_MS = 30_000;

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

/** Rows a viewer may see in the inbox, shared by the page and the badge:
 *  mail from an unclassifiable mailbox is admin-only (isInboxItemVisible), and
 *  anything cleared — for the team or by me — is out of the queue entirely. */
function unreadVisibleCount(
  rows: { id: string; captured_from_user_id: string | null }[],
  readPks: Set<string>,
  dismissedPks: Set<string>,
  mailboxByUser: Map<string, string>,
  isAdmin: boolean,
): number {
  return rows.filter(
    (r) =>
      !readPks.has(r.id) &&
      !dismissedPks.has(r.id) &&
      isInboxItemVisible({ category: categorize(r.captured_from_user_id, mailboxByUser) }, isAdmin),
  ).length;
}

/** Read/dismissed sets for the current user, from the two side tables. */
function sidecarSets(
  reads: { message_pk: string }[],
  dismissals: { message_pk: string; user_id: string | null }[],
  myId: string,
): { readPks: Set<string>; dismissedPks: Set<string> } {
  return {
    readPks: new Set(reads.map((r) => r.message_pk)),
    dismissedPks: new Set(
      dismissals.filter((d) => d.user_id === null || d.user_id === myId).map((d) => d.message_pk),
    ),
  };
}

export function useEmailInbox() {
  const myEmail = (useAuthStore((s) => s.user?.email) ?? '').toLowerCase();
  const myId = useAuthStore((s) => s.user?.id) ?? '';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const query = useQuery({
    queryKey: queryKeys.emailInbox(),
    queryFn: async () => {
      const [msgs, reads, mailboxes, dismissals] = await Promise.all([
        supabase
          .from('email_messages')
          .select(INBOX_COLS)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(300),
        // Bridge: email_message_reads is not yet in generated supabase.ts; drop `as never` after next `npm run types:gen`.
        supabase.from('email_message_reads' as never).select('message_pk'),
        supabase.from('shared_mailboxes' as never).select('user_id, email'),
        // Bridge: email_message_dismissals is not yet in generated supabase.ts; drop `as never` after next `npm run types:gen`.
        supabase.from('email_message_dismissals' as never).select('message_pk, user_id, dismissed_at'),
      ]);
      if (msgs.error) throw new Error(msgs.error.message);
      if (reads.error) throw new Error(reads.error.message);
      if (mailboxes.error) throw new Error(mailboxes.error.message);
      // Tolerate ONLY "table isn't there yet": the frontend and the migration
      // ship separately (and three sessions deploy this repo), so a push that
      // lands before the migration must not take the whole inbox down with it.
      // Any other error still throws.
      const dismissTableMissing =
        !!dismissals.error &&
        (dismissals.error.code === 'PGRST205' ||
          dismissals.error.code === '42P01' ||
          /does not exist|schema cache/i.test(dismissals.error.message));
      if (dismissals.error && !dismissTableMissing) throw new Error(dismissals.error.message);
      const readRows = (reads.data ?? []) as unknown as { message_pk: string }[];
      const mailboxRows = (mailboxes.data ?? []) as unknown as { user_id: string; email: string }[];
      const mailboxByUser = new Map(mailboxRows.map((r) => [r.user_id, r.email.toLowerCase()]));
      // RLS already limits these rows to messages the caller can see; a row
      // with user_id null is a team-wide clear, otherwise it is somebody's
      // personal one and only counts for them.
      const dismissRows = (dismissTableMissing ? [] : (dismissals.data ?? [])) as unknown as { message_pk: string; user_id: string | null; dismissed_at: string }[];
      return {
        rows: msgs.data ?? [],
        readPks: new Set(readRows.map((r) => r.message_pk)),
        mailboxByUser,
        dismissRows,
      };
    },
    staleTime: BADGE_STALE_MS,
    refetchInterval: 60_000,
  });
  const rows = (query.data?.rows ?? []) as unknown as (EmailMessageRow & {
    client_id: string | null; deal_id: string | null; captured_from_user_id: string | null;
  })[];
  const readPks = query.data?.readPks ?? new Set<string>();
  const mailboxByUser = query.data?.mailboxByUser ?? new Map<string, string>();
  const dismissedPks = new Set(
    (query.data?.dismissRows ?? [])
      .filter((d) => d.user_id === null || d.user_id === myId)
      .map((d) => d.message_pk),
  );
  const all: InboxItem[] = rows.map((r) => ({
    ...r,
    unread: !readPks.has(r.id),
    unfiled: !r.client_id && !r.lead_id && !r.job_id && !r.deal_id,
    mine: myEmail !== '' && r.to_email.toLowerCase().includes(myEmail),
    category: categorize(r.captured_from_user_id, mailboxByUser),
    dismissed: dismissedPks.has(r.id),
  }));
  // `items` is the queue: cleared mail is out of it, and therefore out of every
  // count and out of the topbar badge, with no second rule to keep in sync.
  // `clearedItems` backs the Cleared tab, which is the only place they surface.
  const items = all.filter((i) => !i.dismissed);
  const clearedItems = all.filter((i) => i.dismissed);
  const unreadCount = items.filter((i) => i.unread && isInboxItemVisible(i, isAdmin)).length;
  return { ...query, items, clearedItems, unreadCount };
}

/** Topbar badge: the unread count and nothing else.
 *  Deliberately a SEPARATE query key from useEmailInbox — the page's query
 *  carries full message bodies and must not be mounted app-wide. */
export function useEmailInboxBadge(): { unreadCount: number } {
  const myId = useAuthStore((s) => s.user?.id) ?? '';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const query = useQuery({
    queryKey: queryKeys.emailInboxBadge(),
    queryFn: async () => {
      const [msgs, reads, mailboxes, dismissals] = await Promise.all([
        supabase
          .from('email_messages')
          .select(BADGE_COLS)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(300),
        supabase.from('email_message_reads' as never).select('message_pk'),
        supabase.from('shared_mailboxes' as never).select('user_id, email'),
        supabase.from('email_message_dismissals' as never).select('message_pk, user_id'),
      ]);
      if (msgs.error) throw new Error(msgs.error.message);
      if (reads.error) throw new Error(reads.error.message);
      if (mailboxes.error) throw new Error(mailboxes.error.message);
      // Same "not migrated yet" tolerance as the page query.
      const dismissMissing =
        !!dismissals.error &&
        (dismissals.error.code === 'PGRST205' ||
          dismissals.error.code === '42P01' ||
          /does not exist|schema cache/i.test(dismissals.error.message));
      if (dismissals.error && !dismissMissing) throw new Error(dismissals.error.message);

      const rows = (msgs.data ?? []) as unknown as { id: string; captured_from_user_id: string | null }[];
      const mailboxRows = (mailboxes.data ?? []) as unknown as { user_id: string; email: string }[];
      const { readPks, dismissedPks } = sidecarSets(
        (reads.data ?? []) as unknown as { message_pk: string }[],
        (dismissMissing ? [] : (dismissals.data ?? [])) as unknown as { message_pk: string; user_id: string | null }[],
        myId,
      );
      return unreadVisibleCount(
        rows,
        readPks,
        dismissedPks,
        new Map(mailboxRows.map((r) => [r.user_id, r.email.toLowerCase()])),
        isAdmin,
      );
    },
    // A badge does not need second-by-second truth. staleTime stops every route
    // change and window focus from refetching; the interval is the freshness floor.
    staleTime: BADGE_STALE_MS,
    refetchInterval: BADGE_STALE_MS,
  });
  return { unreadCount: query.data ?? 0 };
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

/** Mail captured by a shared mailbox is cleared for the whole team; personal
 *  mail only for the person clearing it. The server enforces this too (see
 *  20260904090000) — this just sends the right shape. */
export function dismissScopeFor(category: InboxCategory): 'shared' | 'own' {
  return category === 'personal' ? 'own' : 'shared';
}

export function useDismissEmail() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  return {
    dismiss: async (item: Pick<InboxItem, 'id' | 'category'>) => {
      if (!userId) return;
      const { error } = await supabase
        // Bridge: email_message_dismissals is not yet in generated supabase.ts; drop `as never` after next `npm run types:gen`.
        .from('email_message_dismissals' as never)
        .insert({
          message_pk: item.id,
          user_id: dismissScopeFor(item.category) === 'own' ? userId : null,
          dismissed_by: userId,
        } as never);
      if (error) throw new Error(error.message);
      void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
    },
    restore: async (item: Pick<InboxItem, 'id' | 'category'>) => {
      if (!userId) return;
      let q = supabase
        .from('email_message_dismissals' as never)
        .delete()
        .eq('message_pk', item.id);
      q = dismissScopeFor(item.category) === 'own' ? q.eq('user_id', userId) : q.is('user_id', null);
      const { error } = await q;
      if (error) throw new Error(error.message);
      void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
    },
  };
}

export function useEmailInboxRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    // COALESCED invalidation. One INSERT used to mean one refetch, and
    // gmail-sync inserts in bursts, so a single page view fired 21 inbox
    // queries — the slowest 52s — and the page's own queries queued behind
    // them (measured live on /accounting, 2026-09-04). Now a burst costs one
    // refetch per window: fire straight away if we are outside the window,
    // otherwise remember it and fire once when the window closes.
    let lastRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      lastRun = Date.now();
      void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
      void qc.invalidateQueries({ queryKey: queryKeys.emailInboxBadge() });
    };
    const onInsert = () => {
      const since = Date.now() - lastRun;
      if (since >= REALTIME_COALESCE_MS) {
        invalidate();
        return;
      }
      if (timer) return; // one already queued for this window
      timer = setTimeout(() => {
        timer = null;
        invalidate();
      }, REALTIME_COALESCE_MS - since);
    };

    // Unique topic per mount — supabase-js reuses channels per identical topic
    // and a second .on() after subscribe() throws (deal 000121, 2026-09-03).
    const channel = supabase
      .channel(`email-inbox-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_messages' }, onInsert)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
