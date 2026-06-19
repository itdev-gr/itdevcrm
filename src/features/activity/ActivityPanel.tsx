import { useTranslation } from 'react-i18next';
import { useActivityLog } from './hooks/useActivityLog';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import {
  type Resolver,
  describeActor,
  diffOf,
  formatValue,
  labelFor,
  snapshotFields,
} from './format';

type Props = { entityType: string; entityId: string };

export function ActivityPanel({ entityType, entityId }: Props) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: rows = [] } = useActivityLog(entityType, entityId);
  const { data: users = [] } = useMentionableUsers();
  const { data: stages = [] } = usePipelineStages();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>;
  }

  const noun = entityType.replace(/s$/, '');
  const resolver: Resolver = { stages, users, lang };

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const who = describeActor(r);
        const when = new Date(r.created_at).toLocaleString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        let summary: string;
        let lines: { key: string; label: string; text: string }[] = [];

        if (r.action === 'insert') {
          summary = `Created the ${noun}`;
          lines = snapshotFields(r.changes)
            .slice(0, 8)
            .map((f) => ({
              key: f.field,
              label: labelFor(f.field),
              text: formatValue(f.value, f.field, resolver),
            }))
            .filter((l) => l.text !== '—');
        } else if (r.action === 'delete') {
          summary = `Deleted the ${noun}`;
        } else {
          const diffs = diffOf(r.changes);
          if (diffs.length === 0) {
            summary = `Saved the ${noun} (no changes)`;
          } else {
            summary = `Updated the ${noun}:`;
            lines = diffs.slice(0, 12).map((d) => ({
              key: d.field,
              label: labelFor(d.field),
              text: `${formatValue(d.before, d.field, resolver)} → ${formatValue(d.after, d.field, resolver)}`,
            }));
          }
        }

        return (
          <li key={r.id} className="rounded-md border bg-card p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{who}</span>
              <span>{when}</span>
            </div>
            <div className="mt-1 text-foreground">{summary}</div>
            {lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {lines.map((l) => (
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
  );
}
