import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { ImportanceBadge } from './ImportanceBadge';
import { importanceOf } from './importance';
import { useResolvedArchive } from './hooks/useResolvedArchive';

const PAGE = 100;

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function ResolvedArchive() {
  const { t, i18n } = useTranslation('common');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [limit, setLimit] = useState(PAGE);
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const { data: entries = [], isLoading } = useResolvedArchive({ meId, limit });

  if (isLoading) return <p className="p-8 text-center text-sm text-muted-foreground">…</p>;
  if (entries.length === 0) {
    return (
      <p className="rounded border border-dashed p-6 text-center text-sm opacity-70">
        {t('tasks_page.archive_empty')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{e.title}</span>
                <ImportanceBadge importance={importanceOf({ importance: e.importance })} />
                {e.link ? (
                  <Link to={e.link} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:text-primary">
                    {e.sourceCode ?? '—'}
                  </Link>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t('tasks_page.personal')}</span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t('tasks_page.resolved_on', { date: formatDate(e.resolvedAt, locale) })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {entries.length >= limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="block w-full rounded-lg border border-dashed border-border/70 py-2.5 text-center text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t('tasks_page.show_more')}
        </button>
      )}
    </div>
  );
}
