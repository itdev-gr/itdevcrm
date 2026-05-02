import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type MentionableUser = {
  user_id: string;
  full_name: string;
  email: string;
  is_admin: boolean;
  group_codes: string[];
};

export function useMentionableUsers() {
  return useQuery({
    queryKey: ['mentionable-users'] as const,
    queryFn: async (): Promise<MentionableUser[]> => {
      const { data, error } = await supabase.rpc('mentionable_users');
      if (error) throw new Error(error.message);
      return (data ?? []) as MentionableUser[];
    },
    staleTime: 60_000,
  });
}
