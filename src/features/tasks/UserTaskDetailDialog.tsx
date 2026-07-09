import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { useToggleTaskComplete } from '@/features/home/hooks/useDeleteTask';
import { StartTaskButton } from './StartTaskButton';
import { TaskDetailShell, type TaskMetaRow, type TaskStatusTone } from './TaskDetailShell';
import type { TaskCard } from './taskCard';

export function UserTaskDetailDialog({
  card, creatorName, onOpenChange,
}: {
  card: TaskCard | null;
  creatorName?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation('home');
  const c = (key: string, opts?: Record<string, unknown>) => t(key, { ns: 'common', ...opts });
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const toggle = useToggleTaskComplete();
  if (!card) return null;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const due = card.dueAt ? fmt(card.dueAt) : null;
  const created = card.createdAtIso ? fmt(card.createdAtIso) : null;

  const statusKey = card.resolved ? 'resolved' : card.startedAtIso ? 'started' : 'open';
  const statusTone = statusKey as TaskStatusTone;

  const rows: TaskMetaRow[] = [];
  if (creatorName) rows.push({ label: c('tasks_page.created_by_label'), value: creatorName });
  if (created) rows.push({ label: c('tasks_page.created_label'), value: created });
  if (due) rows.push({ label: c('tasks_page.due_label'), value: due });
  if (card.clientName) rows.push({ label: c('tasks_page.client_label'), value: card.clientName });
  if (card.leadName) rows.push({ label: c('tasks_page.lead_label'), value: card.leadName });

  // Participants + admin (matches assigned-task dialog gating; RLS enforces server-side).
  const canResolve =
    !card.resolved && (card.relation === 'mine' || card.relation === 'delegated' || isAdmin);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogDescription className="sr-only">{t('task.dialog_description')}</DialogDescription>
        <TaskDetailShell
          title={card.title}
          importance={card.importance}
          statusTone={statusTone}
          statusLabel={c(`tasks_page.status_${statusKey}`)}
          metaRows={rows}
          action={
            <StartTaskButton
              kind="user"
              id={card.id}
              isAssignee={card.relation === 'mine'}
              resolved={card.resolved}
              startedAt={card.startedAtIso}
              locale={locale}
            />
          }
          footer={
            canResolve ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={async () => {
                    await toggle.mutateAsync({ id: card.id, completed: true });
                    onOpenChange(false);
                  }}
                >
                  {c('tasks_page.resolve')}
                </Button>
              </div>
            ) : undefined
          }
          commentsKind="user"
          commentsTaskId={card.id}
          locale={locale}
        >
          {card.notes ? (
            <div className="space-y-1">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {c('tasks_page.description_label')}
              </h4>
              <p className="whitespace-pre-wrap text-sm text-foreground">{card.notes}</p>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">{c('tasks_page.no_description')}</p>
          )}
        </TaskDetailShell>
      </DialogContent>
    </Dialog>
  );
}
