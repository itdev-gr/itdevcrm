import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ImportanceCode } from './importance';

const CLASS: Record<ImportanceCode, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
  high: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
};

export function ImportanceBadge({ importance }: { importance: ImportanceCode }) {
  const { t } = useTranslation('common');
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', CLASS[importance])}>
      {t(`importance.${importance}`)}
    </span>
  );
}
