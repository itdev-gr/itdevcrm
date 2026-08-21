import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = {
  client_id?: string | null;
  lead_id?: string | null;
  template_id: string | null;
  title: string;
  body: string;
};

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, Input>({
    mutationFn: captureMutation('contracts', 'create', async (input: Input): Promise<string> => {
      const { data, error } = await supabase
        .from('contracts')
        .insert({ ...input, status: 'draft' })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to create contract');
      return data.id;
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
