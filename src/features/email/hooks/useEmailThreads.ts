import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type EmailMessageRow = {
  id: string;
  message_id: string;
  thread_id: string | null;
  direction: 'inbound' | 'outbound';
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
  sent_at: string | null;
  department: string | null;
  job_id: string | null;
};

export type EmailThread = {
  key: string;
  subject: string;
  last_at: string | null;
  messages: EmailMessageRow[];
};

const COLS =
  'id, message_id, thread_id, direction, from_email, from_name, to_email, subject, body_text, snippet, sent_at, department, job_id';

export function groupThreads(rows: EmailMessageRow[]): EmailThread[] {
  const map = new Map<string, EmailThread>();
  for (const r of rows) {
    const key = r.thread_id ?? r.id;
    let th = map.get(key);
    if (!th) {
      th = { key, subject: r.subject ?? '(no subject)', last_at: r.sent_at, messages: [] };
      map.set(key, th);
    }
    th.messages.push(r);
    if ((r.sent_at ?? '') >= (th.last_at ?? '')) {
      th.last_at = r.sent_at;
    }
  }
  const threads = [...map.values()];
  for (const th of threads) {
    th.messages.sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''));
  }
  threads.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return threads;
}

export function useEmailThreads(dealId: string): UseQueryResult<EmailThread[]> {
  return useQuery({
    queryKey: ['deal-email-threads', dealId] as const,
    enabled: !!dealId,
    queryFn: async (): Promise<EmailThread[]> => {
      const { data, error } = await supabase
        .from('email_messages' as never)
        .select(COLS)
        .eq('deal_id', dealId)
        .order('sent_at', { ascending: true });
      if (error) throw new Error(error.message);
      return groupThreads((data ?? []) as unknown as EmailMessageRow[]);
    },
  });
}
