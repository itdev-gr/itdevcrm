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

/** Grouping key: real thread when known; otherwise fold Re:/Fwd: chains of the
 *  same subject together (queries are single-scoped so this is safe); blank
 *  subjects stay solo. */
function threadKey(r: EmailMessageRow): string {
  if (r.thread_id) return r.thread_id;
  const norm = (r.subject ?? '')
    .replace(/^((re|fwd?):\s*)+/i, '')
    .trim()
    .toLowerCase();
  return norm ? `subj:${norm}` : r.id;
}

export function groupThreads(rows: EmailMessageRow[]): EmailThread[] {
  const map = new Map<string, EmailThread>();
  for (const r of rows) {
    const key = threadKey(r);
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
    // Newest message first — the collapsed card summarizes messages[0].
    th.messages.sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''));
  }
  threads.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return threads;
}

export type EmailScope = { deal_id?: string; job_id?: string; client_id?: string };

/** Resolve the single active filter column/value from a scope. Precedence:
 *  deal_id → job_id → client_id. Value is '' when nothing is set (query stays
 *  disabled). */
function scopeFilter(scope: EmailScope): readonly [column: string, value: string] {
  if (scope.deal_id) return ['deal_id', scope.deal_id];
  if (scope.job_id) return ['job_id', scope.job_id];
  return ['client_id', scope.client_id ?? ''];
}

export function useEmailThreads(scope: EmailScope): UseQueryResult<EmailThread[]> {
  const [column, value] = scopeFilter(scope);
  return useQuery({
    queryKey: ['email-threads', column, value] as const,
    enabled: !!value,
    queryFn: async (): Promise<EmailThread[]> => {
      const { data, error } = await supabase
        .from('email_messages' as never)
        .select(COLS)
        .eq(column, value)
        .order('sent_at', { ascending: true });
      if (error) throw new Error(error.message);
      return groupThreads((data ?? []) as unknown as EmailMessageRow[]);
    },
  });
}
