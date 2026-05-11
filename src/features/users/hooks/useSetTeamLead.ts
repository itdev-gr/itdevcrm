import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = { userId: string; groupId: string; isLead: boolean };

export function useSetTeamLead() {
  const qc = useQueryClient();
  return useMutation<void, Error, Input>({
    mutationFn: captureMutation<Input, void>(
      'users',
      'set_team_lead',
      async ({ userId, groupId, isLead }) => {
        const { error } = await supabase
          .from('user_groups')
          .update({ is_team_lead: isLead })
          .eq('user_id', userId)
          .eq('group_id', groupId);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: (_d, { userId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.user(userId) });
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
      void qc.invalidateQueries({ queryKey: ['team-leads'] });
    },
  });
}
