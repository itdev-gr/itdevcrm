import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = {
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: 'hidden' | 'readonly';
};

export function useUpsertFieldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('permissions', 'upsert_field_rule', async (vars: Vars) => {
      const { error } = await supabase
        .from('field_permissions')
        .upsert(vars, { onConflict: 'scope_type,scope_id,table_name,field_name' });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.fieldPermissions() });
    },
  });
}
