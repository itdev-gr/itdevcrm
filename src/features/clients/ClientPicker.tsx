import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useClientSearch } from './hooks/useClientSearch';

export type PickedClient = { id: string; name: string };

type Props = {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  id?: string;
};

export function ClientPicker({ value, onChange, id }: Props) {
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

  const { data: results = [], isFetching } = useClientSearch(debounced);

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>{t('client_picker.label')}</Label>
        <div className="flex items-center gap-2">
          <span className="rounded-md border bg-muted px-2 py-1 text-sm">{value.name}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            <X className="size-3.5" /> {t('client_picker.clear')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <Label htmlFor={id}>{t('client_picker.label')}</Label>
      <div className="relative">
        <Input
          id={id}
          value={term}
          placeholder={t('client_picker.search_placeholder')}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open && debounced.length >= 2 && (
          <ul role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
            {results.length === 0 && !isFetching ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">{t('client_picker.no_results')}</li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { onChange({ id: c.id, name: c.name }); setOpen(false); setTerm(''); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.code && <span className="font-mono text-[10px] text-muted-foreground">{c.code}</span>}
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
