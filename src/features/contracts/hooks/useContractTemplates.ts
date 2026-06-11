import { useMutation, useQuery, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { Database } from '@/types/supabase';

export type ContractTemplateRow = Database['public']['Tables']['contract_templates']['Row'];

export function useContractTemplates() {
  return useQuery({
    queryKey: queryKeys.contractTemplates,
    queryFn: async (): Promise<ContractTemplateRow[]> => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useUpsertContractTemplate() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, { id?: string; name: string; body: string }>({
    mutationFn: captureMutation('contracts', 'upsert_template', async ({ id, name, body }) => {
      if (id) {
        const { error } = await supabase.from('contract_templates').update({ name, body }).eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase
        .from('contract_templates')
        .insert({ name, body })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Failed to create template');
      return data.id;
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contractTemplates }),
  });
}

export function useDeleteContractTemplate() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, string>({
    mutationFn: captureMutation('contracts', 'delete_template', async (id: string) => {
      const { error } = await supabase.from('contract_templates').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contractTemplates }),
  });
}
