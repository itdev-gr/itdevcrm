import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { DialogTitle } from '@/components/ui/dialog';
import { ImportanceBadge } from './ImportanceBadge';
import { TaskComments } from './TaskComments';
import type { ImportanceCode } from './importance';

export type TaskStatusTone = 'open' | 'started' | 'resolved';

const STATUS_CLASS: Record<TaskStatusTone, string> = {
  open: 'bg-muted text-muted-foreground',
  started: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
};

export function TaskStatusPill({ tone, label }: { tone: TaskStatusTone; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        STATUS_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}

export type TaskMetaRow = { label: string; value: ReactNode };

/**
 * Shared chrome for both task detail dialogs: a header band (title + importance +
 * status), a two-pane body (meta rail | description + comments), and an optional
 * footer for actions. Keeps the personal and delegated dialogs visually identical.
 */
export function TaskDetailShell({
  title, importance, statusTone, statusLabel, metaRows, action,
  commentsKind, commentsTaskId, locale, footer, commentsReplacement, children,
}: {
  title: string;
  importance: ImportanceCode;
  statusTone: TaskStatusTone;
  statusLabel: string;
  metaRows: TaskMetaRow[];
  action?: ReactNode;
  commentsKind: 'user' | 'assigned';
  commentsTaskId: string;
  locale: string;
  footer?: ReactNode;
  commentsReplacement?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex max-h-[82vh] flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 pb-3 pr-7">
        <DialogTitle className="text-lg font-semibold leading-snug text-foreground">{title}</DialogTitle>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <ImportanceBadge importance={importance} />
          <TaskStatusPill tone={statusTone} label={statusLabel} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto py-4 sm:grid-cols-[170px_1fr]">
        <aside className="space-y-3">
          <dl className="space-y-3">
            {metaRows.map((r) => (
              <div key={r.label} className="space-y-0.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {r.label}
                </dt>
                <dd className="text-sm text-foreground">{r.value}</dd>
              </div>
            ))}
          </dl>
          {action && <div className="pt-0.5">{action}</div>}
        </aside>

        <div className="flex min-w-0 flex-col gap-4 sm:border-l sm:border-border/60 sm:pl-5">
          {children}
          {commentsReplacement ?? <TaskComments kind={commentsKind} taskId={commentsTaskId} locale={locale} />}
        </div>
      </div>

      {footer && <div className="border-t border-border/60 pt-3">{footer}</div>}
    </div>
  );
}
