import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLeadSearch, useLeadTitle } from './hooks/useLeadSearch';

export type PickedLead = { id: string; name: string };

type Props = {
  value: PickedLead | null;
  onChange: (l: PickedLead | null) => void;
  id?: string;
};

export function LeadPicker({ value, onChange, id }: Props) {
  const { t } = useTranslation('common');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(h);
  }, [term]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const { data: results = [], isFetching } = useLeadSearch(debounced);
  // Edit mode passes { id, name: '' } — resolve the title for display.
  const { data: fetchedTitle } = useLeadTitle(value && !value.name ? value.id : null);

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>{t('lead_picker.label')}</Label>
        <div className="flex items-center gap-2">
          <span className="rounded-md border bg-muted px-2 py-1 text-sm">
            {value.name || fetchedTitle || '…'}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            <X className="size-3.5" /> {t('lead_picker.clear')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <Label htmlFor={id}>{t('lead_picker.label')}</Label>
      <div className="relative">
        <Input
          id={id}
          value={term}
          placeholder={t('lead_picker.search_placeholder')}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open && debounced.length >= 2 && (
          <ul role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
            {results.length === 0 && !isFetching ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">{t('lead_picker.no_results')}</li>
            ) : (
              results.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { onChange({ id: l.id, name: l.title }); setOpen(false); setTerm(''); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{l.title}</span>
                    {l.code && <span className="font-mono text-[10px] text-muted-foreground">{l.code}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
