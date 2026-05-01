import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changePassword } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (newPassword: string) => {
      await changePassword(newPassword);
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const { error } = await supabase
          .from('profiles')
          .update({ must_change_password: false })
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
      }
      await qc.invalidateQueries();
    },
  });
}
