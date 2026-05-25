import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useEffectiveGroupCodes, useEffectiveUserId } from '@/lib/viewAs';
import { queryKeys } from '@/lib/queryKeys';

export type FieldMode = 'hidden' | 'readonly';

type Row = {
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: FieldMode;
};

export function useFieldPermissionsAll() {
  const userId = useEffectiveUserId();
  const groupCodes = useEffectiveGroupCodes();

  return useQuery({
    queryKey: [...queryKeys.fieldPermissions(), userId, groupCodes.join(',')] as const,
    queryFn: async () => {
      const { data: groupRows } = await supabase
        .from('groups')
        .select('id')
        .in('code', groupCodes.length > 0 ? groupCodes : ['__none__']);
      const groupIds = (groupRows ?? []).map((g) => g.id);
      const { data, error } = await supabase
        .from('field_permissions')
        .select('scope_type, scope_id, table_name, field_name, mode');
      if (error) throw new Error(error.message);
      const rules = (data as unknown as Row[]) ?? [];
      return rules.filter(
        (r) =>
          (r.scope_type === 'user' && r.scope_id === userId) ||
          (r.scope_type === 'group' && groupIds.includes(r.scope_id)),
      );
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
