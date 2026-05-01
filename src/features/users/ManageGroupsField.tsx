import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useGroups } from '@/features/groups/hooks/useGroups';

type Props = {
  selected: string[]; // group codes
  onChange: (codes: string[]) => void;
};

export function ManageGroupsField({ selected, onChange }: Props) {
  const { i18n } = useTranslation();
  const { data: groups = [] } = useGroups();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const checked = selected.includes(g.code);
        return (
          <div key={g.id} className="flex items-center gap-2">
            <Checkbox
              id={`group-${g.code}`}
              checked={checked}
              onCheckedChange={(value) => {
                if (value) onChange([...selected, g.code]);
                else onChange(selected.filter((c) => c !== g.code));
              }}
            />
            <Label htmlFor={`group-${g.code}`}>{g.display_names[lang]}</Label>
          </div>
        );
      })}
    </div>
  );
}
