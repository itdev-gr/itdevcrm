import { useTranslation } from 'react-i18next';
import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStartTask } from './hooks/useStartTask';
import { canStartTask, startedBadgeVisible } from './taskStarted';

export function StartTaskButton({
  kind, id, isAssignee, resolved, startedAt, locale,
}: {
  kind: 'user' | 'assigned';
  id: string;
  isAssignee: boolean;
  resolved: boolean;
  startedAt: string | null;
  locale: string;
}) {
  const { t } = useTranslation('common');
  const start = useStartTask();

  if (canStartTask({ isAssignee, resolved, startedAt })) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={start.isPending}
        onClick={() => start.mutate({ kind, id })}
      >
        <PlayCircle className="size-3.5" />
        {t('tasks_page.started_button')}
      </Button>
    );
  }
  if (startedBadgeVisible({ resolved, startedAt }) && startedAt) {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(startedAt));
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200">
        <PlayCircle className="size-3" />
        {t('tasks_page.started_badge', { date })}
      </span>
    );
  }
  return null;
}
