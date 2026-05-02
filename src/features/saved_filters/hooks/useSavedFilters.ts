import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type SavedFilterRow = {
  id: string;
  user_id: string;
  board: string;
  name: string;
  filter_json: Record<string, unknown>;
  position: number;
};

export function useSavedFilters(board: string) {
  return useQuery({
    queryKey: queryKeys.savedFilters(board),
    queryFn: async (): Promise<SavedFilterRow[]> => {
      const { data, error } = await supabase
        .from('saved_filters')
        .select('*')
        .eq('board', board)
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SavedFilterRow[];
    },
  });
}
