import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useResolveAssignedTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const { error } = await supabase
        .from('assigned_tasks')
        .update({ status: 'resolved' })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
      return input.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      qc.invalidateQueries({ queryKey: ['client-tasks'] });
    },
  });
}
