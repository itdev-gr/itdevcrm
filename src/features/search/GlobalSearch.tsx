import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { industryLabel } from '@/lib/industries';

type Hit = {
  entity_type: 'lead' | 'client' | 'deal';
  entity_id: string;
  code: string | null;
  label: string | null;
  sublabel: string | null;
  rank: number;
};

const PATH_BY_TYPE: Record<Hit['entity_type'], (id: string) => string> = {
  lead: (id) => `/leads/${id}`,
  client: (id) => `/clients/${id}`,
  deal: (id) => `/deals/${id}`,
};

const TYPE_LABEL: Record<Hit['entity_type'], string> = {
  lead: 'Lead',
  client: 'Client',
  deal: 'Deal',
};

export function GlobalSearch() {
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounce the query so we don't hit the RPC on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const enabled = debounced.length >= 2;
  const search = useQuery({
    queryKey: ['global-search', debounced] as const,
    queryFn: async (): Promise<Hit[]> => {
      const { data, error } = await supabase.rpc('global_search', {
        q: debounced,
        max_rows: 12,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Hit[];
    },
    enabled,
    staleTime: 30_000,
  });

  const hits = search.data ?? [];
  const activeBounded = hits.length > 0 ? Math.min(activeIdx, hits.length - 1) : 0;

  function dismiss() {
    setOpen(false);
    setQ('');
    setActiveIdx(0);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) {
      if (e.key === 'ArrowDown' && hits.length === 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      const pick = hits[activeBounded];
      if (!pick) return;
      e.preventDefault();
      const path = PATH_BY_TYPE[pick.entity_type](pick.entity_id);
      // Navigate via location since we're outside any individual Link.
      window.location.href = path;
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('global_search.placeholder')}
          className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-md border bg-card shadow-md">
          {!enabled ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t('global_search.type_to_search')}
            </div>
          ) : search.isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">…</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('global_search.no_results')}</div>
          ) : (
            <ul>
              {hits.map((h, idx) => (
                <li key={`${h.entity_type}-${h.entity_id}`}>
                  <Link
                    to={PATH_BY_TYPE[h.entity_type](h.entity_id)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={dismiss}
                    className={`flex items-center gap-2 px-3 py-2 text-sm ${
                      idx === activeBounded ? 'bg-muted' : 'hover:bg-muted'
                    }`}
                  >
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {h.code ?? '—'}
                    </span>
                    <span className="flex-1 truncate">
                      <span className="font-medium">{h.label || '—'}</span>
                      {h.sublabel && (
                        <span className="ml-1 text-muted-foreground">
                          {/* Client sublabels carry the industry code; map to its label. */}
                          · {h.entity_type === 'client' ? industryLabel(h.sublabel, lang) : h.sublabel}
                        </span>
                      )}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {TYPE_LABEL[h.entity_type]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
