import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldPermission } from '@/features/permissions/hooks/useFieldPermission';

type Props = ComponentProps<typeof Input> & {
  table: string;
  field: string;
  label: string;
};

export function PermissionAwareInput({ table, field, label, id, ...rest }: Props) {
  const mode = useFieldPermission(table, field);
  if (mode === 'hidden') return null;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} disabled={mode === 'readonly'} {...rest} />
    </div>
  );
}
