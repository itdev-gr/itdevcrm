import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = { userId: string; isActive: boolean };

export function useSetUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('users', 'set_active', async ({ userId, isActive }: Vars) => {
      const { data, error } = await supabase.functions.invoke('set_user_active', {
        body: { user_id: userId, is_active: isActive },
      });
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
      return data as { ok: true };
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
    },
  });
}
