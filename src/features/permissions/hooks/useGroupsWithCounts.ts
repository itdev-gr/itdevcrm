import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type GroupWithCount = {
  id: string;
  code: string;
  display_names: { en: string; el: string };
  parent_label: string | null;
  position: number;
  member_count: number;
};

export function useGroupsWithCounts() {
  return useQuery({
    queryKey: [...queryKeys.groups(), 'with-counts'] as const,
    queryFn: async (): Promise<GroupWithCount[]> => {
      const { data: groups, error: e1 } = await supabase
        .from('groups')
        .select('id, code, display_names, parent_label, position')
        .eq('archived', false)
        .order('position');
      if (e1) throw new Error(e1.message);
      const { data: counts, error: e2 } = await supabase.from('user_groups').select('group_id');
      if (e2) throw new Error(e2.message);
      const tally = new Map<string, number>();
      (counts ?? []).forEach((r) => tally.set(r.group_id, (tally.get(r.group_id) ?? 0) + 1));
      return (groups ?? []).map((g) => ({
        ...(g as unknown as Omit<GroupWithCount, 'member_count'>),
        member_count: tally.get(g.id) ?? 0,
      }));
    },
  });
}
