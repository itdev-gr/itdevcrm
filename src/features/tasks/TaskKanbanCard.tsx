import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ImportanceBadge } from './ImportanceBadge';
import { startedBadgeVisible } from './taskStarted';
import { NEW_TASK_RING, NewTaskDot } from './taskHighlightStyle';
import { cardDualResolveState, isDraggable, type TaskCard, type DragAction } from './taskCard';
import { awaitingLabelParty } from './dualResolve';

export function TaskKanbanCard({
  card, nameFor, onAction, onOpen, highlight = false, unreadComments = 0,
}: {
  card: TaskCard;
  nameFor: (id: string) => string;
  onAction: (action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  highlight?: boolean;
  unreadComments?: number;
}) {
  const { t } = useTranslation('common');
  const draggable = isDraggable(card);
  // Resolve/Reopen is gated on assignment, not drag — the button and drag
  // coexist on every card, including ones parked in Replies.
  const canAct = card.relation === 'mine';
  // Half-resolved (one side stamped) → who is still pending, for the badge.
  const awaiting = awaitingLabelParty(cardDualResolveState(card));
  const awaitingName =
    awaiting === 'creator' && card.creatorId
      ? nameFor(card.creatorId)
      : awaiting === 'assignee'
        ? nameFor(card.assigneeId)
        : '';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.key, data: { card }, disabled: !draggable,
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      // dnd-kit marks non-draggable cards aria-disabled, but every card stays
      // clickable (opens the dialog) and Replies cards keep their action button.
      aria-disabled={undefined}
      {...listeners}
      // dnd-kit makes the draggable wrapper a role="button"; label it by the
      // task title so its accessible name doesn't swallow the inner buttons.
      aria-label={card.title}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button')) return;
        onOpen(card);
      }}
      className={cn(
        'rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-sm',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        highlight && NEW_TASK_RING,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {highlight && <NewTaskDot />}
        <span className="truncate text-sm font-medium">{card.title}</span>
        <ImportanceBadge importance={card.importance} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {card.link ? (
          <Link to={card.link} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:text-primary">
            {card.sourceCode ?? '—'}
          </Link>
        ) : card.clientName && card.clientId ? (
          <Link
            to={`/clients/${card.clientId}`}
            className="inline-block max-w-[10rem] truncate rounded bg-muted px-1.5 py-0.5 text-[10px] hover:text-primary"
          >
            {card.clientName}
          </Link>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t('tasks_page.personal')}</span>
        )}
        {unreadComments > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            💬 {unreadComments}
          </span>
        )}
        {card.relation === 'delegated' && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t('tasks_page.assigned_to', { name: nameFor(card.assigneeId) })}
          </span>
        )}
        {startedBadgeVisible({ resolved: card.resolved, startedAt: card.startedAtIso }) && (
          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200">
            {t('tasks_page.started_short')}
          </span>
        )}
        {awaiting && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            {awaitingName
              ? t('tasks_page.awaiting_confirmation', { name: awaitingName })
              : t('tasks_page.awaiting_confirmation_nameless')}
          </span>
        )}
      </div>
      {canAct && (
        <div className="mt-2">
          {card.resolved ? (
            <Button type="button" size="sm" variant="outline" className="h-7"
              onClick={() => onAction({ type: 'reopen', importance: card.importance })}>
              <RotateCcw className="size-3.5" />
              {t('tasks_page.reopen')}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" className="h-7"
              onClick={() => onAction({ type: 'resolve' })}>
              <CheckCircle2 className="size-3.5" />
              {t('tasks_page.resolve')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
