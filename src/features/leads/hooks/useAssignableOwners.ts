import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type AssignableOwner = {
  user_id: string;
  full_name: string;
  email: string;
  is_admin: boolean;
};

export function useAssignableOwners() {
  return useQuery({
    queryKey: ['assignable-owners'] as const,
    queryFn: async (): Promise<AssignableOwner[]> => {
      const { data, error } = await supabase.rpc('assignable_owners');
      if (error) throw new Error(error.message);
      return (data ?? []) as AssignableOwner[];
    },
    staleTime: 60_000,
  });
}
