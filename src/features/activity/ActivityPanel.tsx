import { useTranslation } from 'react-i18next';
import { useActivityLog } from './hooks/useActivityLog';

type Props = { entityType: string; entityId: string };

export function ActivityPanel({ entityType, entityId }: Props) {
  const { t } = useTranslation('sales');
  const { data: rows = [] } = useActivityLog(entityType, entityId);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border bg-white p-3 text-sm">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{r.user?.full_name ?? r.user?.email ?? 'system'}</span>
            <span>{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <span className="font-medium uppercase">{r.action}</span>
          {' on '}
          <span className="text-muted-foreground">{r.entity_type}</span>
        </li>
      ))}
    </ul>
  );
}
