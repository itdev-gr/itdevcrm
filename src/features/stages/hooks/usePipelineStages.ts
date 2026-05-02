import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type StageRow = {
  id: string;
  board: string;
  code: string;
  display_names: { en: string; el: string };
  position: number;
  color: string | null;
  is_terminal: boolean;
  terminal_outcome: string | null;
  triggers_action: string | null;
  archived: boolean;
};

export function usePipelineStages() {
  return useQuery({
    queryKey: queryKeys.pipelineStages(),
    queryFn: async (): Promise<StageRow[]> => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('board')
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as StageRow[];
    },
  });
}
