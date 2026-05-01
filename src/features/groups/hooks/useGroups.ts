import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type Group = {
  id: string;
  code: string;
  display_names: { en: string; el: string };
  parent_label: string | null;
  position: number;
};

export function useGroups() {
  return useQuery({
    queryKey: queryKeys.groups(),
    queryFn: async (): Promise<Group[]> => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, code, display_names, parent_label, position')
        .eq('archived', false)
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Group[];
    },
  });
}
