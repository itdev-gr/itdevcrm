import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = {
  userId: string;
  full_name?: string;
  is_admin?: boolean;
  is_active?: boolean;
};

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('users', 'update', async ({ userId, ...patch }: Vars) => {
      const { error } = await supabase.from('profiles').update(patch).eq('user_id', userId);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
      void qc.invalidateQueries({ queryKey: queryKeys.user(vars.userId) });
    },
  });
}
