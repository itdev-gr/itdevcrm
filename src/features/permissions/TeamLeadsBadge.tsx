import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type LeadRow = {
  user_id: string;
  profiles: { full_name: string | null; email: string } | null;
};

export function TeamLeadsBadge({ groupId }: { groupId: string }) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['team-leads', 'group', groupId],
    queryFn: async (): Promise<LeadRow[]> => {
      const { data, error } = await supabase
        .from('user_groups')
        .select('user_id, profiles(full_name, email)')
        .eq('group_id', groupId)
        .eq('is_team_lead', true);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LeadRow[];
    },
    enabled: !!groupId,
  });

  if (isLoading) return null;
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-3 text-xs text-muted-foreground">
        No team lead set — new jobs for this department will spawn unassigned.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs">
      <span className="font-medium text-emerald-800 dark:text-emerald-300">Team leads:</span>{' '}
      <span className="text-emerald-700 dark:text-emerald-400">
        {leads
          .map((l) => l.profiles?.full_name?.trim() || l.profiles?.email || l.user_id)
          .join(', ')}
      </span>
    </div>
  );
}
