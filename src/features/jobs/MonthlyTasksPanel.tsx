import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { relativeFromNow } from '@/lib/datetime';
import {
  useJobMonthlyTasks,
  type MonthlyTask,
  type MonthlyTaskLabel,
} from './hooks/useJobMonthlyTasks';
import { useToggleMonthlyTask } from './hooks/useToggleMonthlyTask';

type Props = {
  jobId: string;
  serviceType: string;
  isBlocked: boolean;
};

function formatPeriod(period: string | null, lang: 'en' | 'el'): string {
  if (!period) return '—';
  // period is YYYY-MM
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return period;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function MonthlyTasksPanel({ jobId, serviceType, isBlocked }: Props) {
  const { t, i18n } = useTranslation('jobs');
  const lang: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data, isLoading } = useJobMonthlyTasks(jobId, serviceType);
  const toggle = useToggleMonthlyTask(jobId);
  const { data: owners = [] } = useMentionableUsers();

  if (isLoading || !data) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        {t('monthly_tasks.title')}…
      </div>
    );
  }

  const labelByCode = new Map<string, MonthlyTaskLabel>();
  for (const tpl of data.template) labelByCode.set(tpl.code, tpl);

  // Render order follows the template; tasks without a label fall to the end.
  const ordered: { task: MonthlyTask; label: MonthlyTaskLabel | null }[] = [];
  const seen = new Set<string>();
  for (const tpl of data.template) {
    const t = data.tasks.find((x) => x.code === tpl.code);
    if (t) {
      ordered.push({ task: t, label: tpl });
      seen.add(tpl.code);
    }
  }
  for (const t of data.tasks) {
    if (!seen.has(t.code)) ordered.push({ task: t, label: labelByCode.get(t.code) ?? null });
  }

  const total = ordered.length;
  const done = ordered.filter((o) => o.task.completed).length;
  const disabled = isBlocked || toggle.isPending;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b bg-muted px-4 py-2">
        <div>
          <div className="text-sm font-medium">
            {t('monthly_tasks.for_period', { period: formatPeriod(data.period, lang) })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('monthly_tasks.progress', { done, total })}
          </div>
        </div>
      </div>
      {ordered.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">{t('monthly_tasks.empty')}</div>
      ) : (
        <ul className="divide-y">
          {ordered.map(({ task, label }) => {
            const text = label ? (lang === 'el' ? label.label_el : label.label_en) : task.code;
            const owner = task.completed_by
              ? owners.find((o) => o.user_id === task.completed_by)
              : null;
            return (
              <li
                key={task.code}
                className={`flex items-start gap-3 px-4 py-2 text-sm ${disabled ? 'opacity-80' : ''}`}
              >
                <Checkbox
                  checked={task.completed}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    void toggle.mutate({
                      jobId,
                      code: task.code,
                      completed: checked === true,
                    });
                  }}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className={task.completed ? 'text-muted-foreground line-through' : ''}>{text}</div>
                  {task.completed && task.completed_at && (
                    <div className="text-[11px] text-muted-foreground">
                      {t('monthly_tasks.completed_by', {
                        name: owner?.full_name || owner?.email || '—',
                        when: relativeFromNow(task.completed_at),
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {isBlocked && (
        <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          {t('monthly_tasks.blocked_hint')}
        </div>
      )}
    </div>
  );
}
