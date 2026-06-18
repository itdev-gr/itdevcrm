import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CallLink } from '@/components/CallLink';
import { cn } from '@/lib/utils';

export type ContactValue = { full_name: string; email: string; phone: string; info: string };

type Props = {
  value: ContactValue;
  onChange: (next: ContactValue) => void;
  onRemove?: (() => void) | undefined;
  disabled?: boolean | undefined;
  startEditing?: boolean | undefined;
  idPrefix?: string | undefined;
};

const cardClass = 'rounded-lg border border-border/60 bg-muted/20 p-4';

export function EditableContact({
  value, onChange, onRemove, disabled, startEditing, idPrefix = 'c',
}: Props) {
  const [editing, setEditing] = useState(!!startEditing);
  const set = (patch: Partial<ContactValue>) => onChange({ ...value, ...patch });

  if (!editing) {
    const hasContent = value.full_name || value.email || value.phone || value.info;
    return (
      <div className={cn(cardClass, 'flex items-start justify-between gap-3')}>
        <div className="min-w-0 space-y-1 text-sm">
          {value.full_name ? (
            <div className="font-medium">{value.full_name}</div>
          ) : (
            <div className="text-muted-foreground/60">—</div>
          )}
          {value.email && (
            <div>
              <a
                href={`mailto:${value.email}`}
                className="font-medium text-primary hover:underline"
              >
                {value.email}
              </a>
            </div>
          )}
          {value.phone && (
            <div>
              <CallLink phone={value.phone} />
            </div>
          )}
          {value.info && <div className="text-muted-foreground">{value.info}</div>}
          {!hasContent && !disabled && (
            <p className="text-xs text-muted-foreground">Click edit to add contact details.</p>
          )}
        </div>
        {!disabled && (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Edit contact"
              className="size-8 p-0"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
            {onRemove && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Remove contact"
                className="size-8 p-0 text-destructive hover:text-destructive"
                onClick={onRemove}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn(cardClass, 'grid grid-cols-2 gap-3')}>
      <div className="col-span-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">
          Full name
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.full_name}
          disabled={disabled}
          className="mt-1.5"
          onChange={(e) => set({ full_name: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-email`} className="text-xs">
          Email
        </Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          value={value.email}
          disabled={disabled}
          className="mt-1.5"
          onChange={(e) => set({ email: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-phone`} className="text-xs">
          Phone
        </Label>
        <Input
          id={`${idPrefix}-phone`}
          value={value.phone}
          disabled={disabled}
          className="mt-1.5"
          onChange={(e) => set({ phone: e.target.value })}
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor={`${idPrefix}-info`} className="text-xs">
          Info
        </Label>
        <Input
          id={`${idPrefix}-info`}
          value={value.info}
          disabled={disabled}
          className="mt-1.5"
          placeholder="e.g. CFO · best after 5pm"
          onChange={(e) => set({ info: e.target.value })}
        />
      </div>
      <div className="col-span-2 flex justify-end gap-2">
        {onRemove && (
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    </div>
  );
}
