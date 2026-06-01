import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type AdditionalContact = {
  full_name: string;
  email: string;
  phone: string;
  info: string;
};

type Props = {
  value: AdditionalContact[];
  onChange: (next: AdditionalContact[]) => void;
  disabled?: boolean;
};

const EMPTY: AdditionalContact = { full_name: '', email: '', phone: '', info: '' };

export function AdditionalContactsField({ value, onChange, disabled }: Props) {
  function addRow() {
    onChange([...value, { ...EMPTY }]);
  }
  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function patchRow(idx: number, patch: Partial<AdditionalContact>) {
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="space-y-3">
          {value.map((row, idx) => (
            <li
              key={idx}
              className="grid grid-cols-2 gap-3 rounded-md border bg-slate-50 p-3"
            >
              <div>
                <Label htmlFor={`ac-name-${idx}`} className="text-xs">
                  Full name
                </Label>
                <Input
                  id={`ac-name-${idx}`}
                  value={row.full_name}
                  onChange={(e) => patchRow(idx, { full_name: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor={`ac-email-${idx}`} className="text-xs">
                  Email
                </Label>
                <Input
                  id={`ac-email-${idx}`}
                  type="email"
                  value={row.email}
                  onChange={(e) => patchRow(idx, { email: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor={`ac-phone-${idx}`} className="text-xs">
                  Phone
                </Label>
                <Input
                  id={`ac-phone-${idx}`}
                  value={row.phone}
                  onChange={(e) => patchRow(idx, { phone: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor={`ac-info-${idx}`} className="text-xs">
                  Info
                </Label>
                <Input
                  id={`ac-info-${idx}`}
                  value={row.info}
                  onChange={(e) => patchRow(idx, { info: e.target.value })}
                  placeholder="e.g. CFO · best after 5pm"
                  disabled={disabled}
                />
              </div>
              {!disabled && (
                <div className="col-span-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => removeRow(idx)}
                  >
                    × Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          + Add contact
        </Button>
      )}
    </div>
  );
}

 
export function parseAdditionalContacts(value: unknown): AdditionalContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      full_name: typeof row.full_name === 'string' ? row.full_name : '',
      email: typeof row.email === 'string' ? row.email : '',
      phone: typeof row.phone === 'string' ? row.phone : '',
      info: typeof row.info === 'string' ? row.info : '',
    }));
}
