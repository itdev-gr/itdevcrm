import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useClientSearch } from '@/features/clients/hooks/useClientSearch';
import { useLeadSearch } from '@/features/leads/hooks/useLeadSearch';

export type ContractParty = { type: 'client' | 'lead'; id: string; name: string };

type Props = {
  value: ContractParty | null;
  onChange: (p: ContractParty | null) => void;
  id?: string;
};

function TypeBadge({ type }: { type: ContractParty['type'] }) {
  const { t } = useTranslation('common');
  return (
    <span
      className={
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
        (type === 'client'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300')
      }
    >
      {t(type === 'client' ? 'party_picker.badge_client' : 'party_picker.badge_lead')}
    </span>
  );
}

/** Unified client-OR-lead typeahead for contracts. Searches both entities on
 *  one term (name, code, email, phone, VAT, contact name — see the hooks). */
export function ContractPartyPicker({ value, onChange, id }: Props) {
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

  const { data: clients = [], isFetching: clientsFetching } = useClientSearch(debounced);
  const { data: leads = [], isFetching: leadsFetching } = useLeadSearch(debounced);
  const isFetching = clientsFetching || leadsFetching;
  const empty = clients.length === 0 && leads.length === 0;

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-sm">
          <TypeBadge type={value.type} />
          {value.name}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          <X className="size-3.5" /> {t('party_picker.clear')}
        </Button>
      </div>
    );
  }

  function pick(p: ContractParty) {
    onChange(p);
    setOpen(false);
    setTerm('');
  }

  function row(
    key: string,
    party: ContractParty,
    code: string | null,
    sublabel: string,
  ) {
    return (
      <li key={key}>
        <button
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => pick(party)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
        >
          <TypeBadge type={party.type} />
          <span className="truncate font-medium">{party.name}</span>
          {sublabel && (
            <span className="truncate text-xs text-muted-foreground">{sublabel}</span>
          )}
          {code && (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {code}
            </span>
          )}
        </button>
      </li>
    );
  }

  return (
    <div className="relative min-w-64" ref={boxRef}>
      <Label htmlFor={id} className="sr-only">
        {t('party_picker.label')}
      </Label>
      <Input
        id={id}
        value={term}
        placeholder={t('party_picker.search_placeholder')}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && debounced.length >= 2 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full min-w-80 overflow-auto rounded-md border bg-popover shadow-md"
        >
          {empty && !isFetching ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {t('party_picker.no_results')}
            </li>
          ) : (
            <>
              {clients.map((c) =>
                row(
                  `client-${c.id}`,
                  { type: 'client', id: c.id, name: c.name },
                  c.code,
                  [c.email, c.phone].filter(Boolean).join(' · '),
                ),
              )}
              {leads.map((l) =>
                row(
                  `lead-${l.id}`,
                  { type: 'lead', id: l.id, name: l.company_name ?? l.title },
                  l.code,
                  [l.email, l.phone].filter(Boolean).join(' · '),
                ),
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
