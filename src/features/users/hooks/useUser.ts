import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserRow } from './useUsers';

export function useUser(userId: string) {
  return useQuery({
    queryKey: queryKeys.user(userId),
    queryFn: async (): Promise<UserRow> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'user_id, full_name, email, avatar_url, is_admin, is_active, must_change_password, preferred_locale, archived, archived_at, archived_by, archived_reason, created_at, updated_at, user_groups(groups(id, code))',
        )
        .eq('user_id', userId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data as unknown as UserRow;
    },
    enabled: !!userId,
  });
}
