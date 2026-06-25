import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useClientActivity } from './hooks/useClientActivity';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { type ActivityCategory, type Resolver, categoryOf, describeActor, describeEvent } from './format';

type FilterKey = 'all' | ActivityCategory;
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'payment', label: 'Payments' },
  { key: 'email', label: 'Emails' },
  { key: 'job', label: 'Jobs' },
  { key: 'deal', label: 'Deals' },
  { key: 'attachment', label: 'Files' },
  { key: 'task', label: 'Tasks' },
];

export function ClientActivityPanel({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useClientActivity(clientId);
  const { data: users = [] } = useMentionableUsers();
  const { data: stages = [] } = usePipelineStages();
  const [filter, setFilter] = useState<FilterKey>('all');

  const rows = useMemo(() => data?.pages.flat() ?? [], [data]);
  const resolver: Resolver = { stages, users, lang };
  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => categoryOf(r.entity_type) === filter)),
    [rows, filter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const who = describeActor(r);
            const when = new Date(r.created_at).toLocaleString('en-GB', {
              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            const view = describeEvent(r, resolver);
            return (
              <li key={r.id} className="rounded-md border bg-card p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{who}</span>
                  <span>{when}</span>
                </div>
                <div className="mt-1 text-foreground">{view.summary}</div>
                {view.lines.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {view.lines.map((l) => (
                      <li key={l.key}>
                        <span className="font-medium text-foreground">{l.label}:</span> {l.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? '…' : t('activity.loadMore', 'Load more')}
        </Button>
      )}
    </div>
  );
}
