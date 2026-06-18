import { Button } from '@/components/ui/button';
import { EditableContact } from './EditableContact';

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
  function patchRow(idx: number, next: AdditionalContact) {
    onChange(value.map((row, i) => (i === idx ? next : row)));
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="space-y-3">
          {value.map((row, idx) => (
            <li key={idx}>
              <EditableContact
                value={row}
                onChange={(next) => patchRow(idx, next)}
                onRemove={disabled ? undefined : () => removeRow(idx)}
                disabled={disabled}
                startEditing={!row.full_name && !row.email && !row.phone && !row.info}
                idPrefix={`ac-${idx}`}
              />
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Button type="button" size="sm" variant="outline" onClick={addRow} className="rounded-lg">
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
