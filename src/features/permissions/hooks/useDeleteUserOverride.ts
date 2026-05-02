import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useDeleteUserOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId: _userId, id }: { userId: string; id: string }) => {
      const { error } = await supabase.from('user_permissions').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.userOverrides(vars.userId) });
      void qc.invalidateQueries({ queryKey: queryKeys.effectivePermissions(vars.userId) });
    },
  });
}
