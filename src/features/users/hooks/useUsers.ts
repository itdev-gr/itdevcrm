import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type UserRow = Database['public']['Tables']['profiles']['Row'] & {
  user_groups: { groups: { id: string; code: string } | null }[] | null;
};

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: async (): Promise<UserRow[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'user_id, full_name, email, avatar_url, is_admin, is_active, must_change_password, preferred_locale, archived, archived_at, archived_by, archived_reason, created_at, updated_at, user_groups(groups(id, code))',
        )
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as UserRow[];
    },
  });
}
