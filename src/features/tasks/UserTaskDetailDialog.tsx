import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { useResolveTask, useUnresolveTask } from './hooks/useResolveTask';
import { StartTaskButton } from './StartTaskButton';
import { TaskDetailShell, type TaskMetaRow, type TaskStatusTone } from './TaskDetailShell';
import { cardDualResolveState, type TaskCard } from './taskCard';
import { resolveAction, awaitingLabelParty } from './dualResolve';

export function UserTaskDetailDialog({
  card, creatorName, assigneeName, onOpenChange,
}: {
  card: TaskCard | null;
  creatorName?: string | null;
  assigneeName?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation('home');
  const c = (key: string, opts?: Record<string, unknown>) => t(key, { ns: 'common', ...opts });
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const resolve = useResolveTask();
  const unresolve = useUnresolveTask();
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
  if (card.clientName) {
    rows.push({
      label: c('tasks_page.client_label'),
      value: card.clientId ? (
        <Link to={`/clients/${card.clientId}`} className="hover:text-primary hover:underline">
          {card.clientName}
        </Link>
      ) : (
        card.clientName
      ),
    });
  }
  if (card.leadName) rows.push({ label: c('tasks_page.lead_label'), value: card.leadName });

  // Dual-resolve: the primary button depends on who has stamped which side.
  const state = cardDualResolveState(card);
  const action = resolveAction(state, meId || null, isAdmin);
  const awaiting = awaitingLabelParty(state);
  const awaitingName =
    awaiting === 'creator' ? creatorName : awaiting === 'assignee' ? assigneeName : null;

  const primaryLabel =
    action === 'withdraw'
      ? c('tasks_page.withdraw')
      : action === 'confirm_close'
        ? c('tasks_page.confirm_close')
        : c('tasks_page.resolve');

  async function onPrimary() {
    if (!action || !card) return;
    if (action === 'withdraw') {
      await unresolve.mutateAsync({ kind: 'user', id: card.id });
      return; // stay open — the dialog re-renders back to the Resolve state
    }
    const res = await resolve.mutateAsync({ kind: 'user', id: card.id });
    if (res.closed) onOpenChange(false);
  }

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
            action ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={resolve.isPending || unresolve.isPending}
                  onClick={onPrimary}
                >
                  {primaryLabel}
                </Button>
              </div>
            ) : undefined
          }
          commentsKind="user"
          commentsTaskId={card.id}
          locale={locale}
        >
          {awaiting && (
            <div className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              {awaitingName
                ? c('tasks_page.awaiting_confirmation', { name: awaitingName })
                : c('tasks_page.awaiting_confirmation_nameless')}
            </div>
          )}
          {card.resolved && card.summary && (
            <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {c('tasks_page.summary')}
              </h4>
              <p className="whitespace-pre-wrap text-sm text-foreground">{card.summary}</p>
            </div>
          )}
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
