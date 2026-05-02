import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSavedFilters } from './hooks/useSavedFilters';
import { useUpsertSavedFilter } from './hooks/useUpsertSavedFilter';

type Props = {
  board: string;
  currentFilter: Record<string, unknown>;
  onApply: (filter: Record<string, unknown>) => void;
};

export function SavedFiltersBar({ board, currentFilter, onApply }: Props) {
  const { t } = useTranslation('sales');
  const { data: filters = [] } = useSavedFilters(board);
  const upsert = useUpsertSavedFilter();
  const [name, setName] = useState('');

  return (
    <div className="flex items-center gap-2">
      {filters.map((f) => (
        <Button key={f.id} variant="outline" size="sm" onClick={() => onApply(f.filter_json)}>
          {f.name}
        </Button>
      ))}
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('filters.name_placeholder')}
        className="h-8 w-40 text-sm"
      />
      <Button
        size="sm"
        onClick={() => {
          if (!name.trim()) return;
          void upsert
            .mutateAsync({ board, name: name.trim(), filter_json: currentFilter })
            .then(() => setName(''));
        }}
        disabled={upsert.isPending || !name.trim()}
      >
        {t('filters.save_current')}
      </Button>
    </div>
  );
}
