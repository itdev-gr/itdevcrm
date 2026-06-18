import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CallLink } from '@/components/CallLink';

export type ContactValue = { full_name: string; email: string; phone: string; info: string };

type Props = {
  value: ContactValue;
  onChange: (next: ContactValue) => void;
  onRemove?: (() => void) | undefined;
  disabled?: boolean | undefined;
  startEditing?: boolean | undefined;
  idPrefix?: string | undefined;
};

export function EditableContact({
  value, onChange, onRemove, disabled, startEditing, idPrefix = 'c',
}: Props) {
  const [editing, setEditing] = useState(!!startEditing);
  const set = (patch: Partial<ContactValue>) => onChange({ ...value, ...patch });

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border bg-muted p-3">
        <div className="min-w-0 space-y-0.5 text-sm">
          <div className="font-medium">{value.full_name || '—'}</div>
          {value.email && (
            <div>
              <a href={`mailto:${value.email}`} className="text-blue-700 hover:underline dark:text-blue-400">{value.email}</a>
            </div>
          )}
          {value.phone && <div><CallLink phone={value.phone} /></div>}
          {value.info && <div className="text-muted-foreground">{value.info}</div>}
        </div>
        {!disabled && (
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="outline" aria-label="Edit contact"
              onClick={() => setEditing(true)}>✏️</Button>
            {onRemove && (
              <Button type="button" size="sm" variant="destructive" aria-label="Remove contact"
                onClick={onRemove}>×</Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted p-3">
      <div className="col-span-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">Full name</Label>
        <Input id={`${idPrefix}-name`} value={value.full_name} disabled={disabled}
          onChange={(e) => set({ full_name: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-email`} className="text-xs">Email</Label>
        <Input id={`${idPrefix}-email`} type="email" value={value.email} disabled={disabled}
          onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-phone`} className="text-xs">Phone</Label>
        <Input id={`${idPrefix}-phone`} value={value.phone} disabled={disabled}
          onChange={(e) => set({ phone: e.target.value })} />
      </div>
      <div className="col-span-2">
        <Label htmlFor={`${idPrefix}-info`} className="text-xs">Info</Label>
        <Input id={`${idPrefix}-info`} value={value.info} disabled={disabled}
          placeholder="e.g. CFO · best after 5pm"
          onChange={(e) => set({ info: e.target.value })} />
      </div>
      <div className="col-span-2 flex justify-end gap-1">
        {onRemove && (
          <Button type="button" size="sm" variant="destructive" onClick={onRemove}>× Remove</Button>
        )}
        <Button type="button" size="sm" onClick={() => setEditing(false)}>✓ Done</Button>
      </div>
    </div>
  );
}
