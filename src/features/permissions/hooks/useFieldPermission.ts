import { useFieldPermissionsAll, type FieldMode } from './useFieldPermissionsAll';

export type FieldPermission = 'editable' | 'readonly' | 'hidden';

const SEVERITY: Record<FieldMode, number> = { readonly: 1, hidden: 2 };

export function useFieldPermission(table: string, field: string): FieldPermission {
  const { data: rules = [] } = useFieldPermissionsAll();
  const matches = rules.filter((r) => r.table_name === table && r.field_name === field);
  if (matches.length === 0) return 'editable';
  const userMatch = matches.find((m) => m.scope_type === 'user');
  if (userMatch) return userMatch.mode;
  const groupMode = matches.reduce<FieldMode>((acc, m) => {
    return SEVERITY[m.mode] > SEVERITY[acc] ? m.mode : acc;
  }, 'readonly');
  return groupMode;
}
