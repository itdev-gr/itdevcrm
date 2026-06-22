import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ArchiveEntry = {
  key: string;
  id: string;
  kind: 'user' | 'assigned';
  title: string;
  importance: string;
  resolvedAt: string;
  sourceCode: string | null;
  link: string | null;
};

type UserResolvedRow = { id: string; title: string; importance: string; completed_at: string };
type AssignedResolvedRow = {
  id: string; title: string; importance: string; resolved_at: string;
  deal_id: string | null; job_id: string | null; source_code: string | null;
};

export function mergeArchiveEntries(
  userRows: UserResolvedRow[],
  assignedRows: AssignedResolvedRow[],
  limit: number,
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [
    ...userRows.map((r) => ({
      key: `user:${r.id}`, id: r.id, kind: 'user' as const, title: r.title,
      importance: r.importance, resolvedAt: r.completed_at, sourceCode: null, link: null,
    })),
    ...assignedRows.map((r) => ({
      key: `assigned:${r.id}`, id: r.id, kind: 'assigned' as const, title: r.title,
      importance: r.importance, resolvedAt: r.resolved_at, sourceCode: r.source_code,
      link: r.deal_id ? `/deals/${r.deal_id}` : r.job_id ? `/jobs/${r.job_id}` : null,
    })),
  ];
  return entries
    .sort((x, y) => (x.resolvedAt < y.resolvedAt ? 1 : x.resolvedAt > y.resolvedAt ? -1 : 0))
    .slice(0, limit);
}

/** Every task the current user has resolved (full history), newest first. */
export function useResolvedArchive(params: { meId: string; limit: number }) {
  const { meId, limit } = params;
  return useQuery<ArchiveEntry[]>({
    queryKey: queryKeys.tasksArchive(meId, limit),
    enabled: meId.length > 0,
    queryFn: async () => {
      const [u, a] = await Promise.all([
        supabase
          .from('user_tasks')
          .select('id, title, importance, completed_at')
          .eq('user_id', meId)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(limit),
        supabase
          .from('assigned_tasks')
          .select('id, title, importance, resolved_at, deal_id, job_id, source_code')
          .eq('resolved_by_user_id', meId)
          .order('resolved_at', { ascending: false })
          .limit(limit),
      ]);
      if (u.error) throw new Error(u.error.message);
      if (a.error) throw new Error(a.error.message);
      return mergeArchiveEntries(
        (u.data ?? []) as UserResolvedRow[],
        (a.data ?? []) as AssignedResolvedRow[],
        limit,
      );
    },
  });
}
