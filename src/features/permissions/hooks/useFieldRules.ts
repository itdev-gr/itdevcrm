import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type FieldRuleRow = {
  id: string;
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: 'hidden' | 'readonly';
};

export function useFieldRules() {
  return useQuery({
    queryKey: queryKeys.fieldPermissions(),
    queryFn: async (): Promise<FieldRuleRow[]> => {
      const { data, error } = await supabase
        .from('field_permissions')
        .select('id, scope_type, scope_id, table_name, field_name, mode')
        .order('table_name')
        .order('field_name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FieldRuleRow[];
    },
  });
}
