import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = {
  email: string;
  full_name: string;
  temp_password: string;
  group_codes: string[];
  is_admin?: boolean;
};

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Vars) => {
      const { data, error } = await supabase.functions.invoke('invite_user', { body: vars });
      if (error) {
        let msg = error.message;
        try {
          const ctx = error.context as { json?: () => Promise<{ error?: string }> } | undefined;
          if (ctx?.json) {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      return data as { user_id: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
    },
  });
}
