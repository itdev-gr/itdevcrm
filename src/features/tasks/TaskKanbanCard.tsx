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
import { isDraggable, type TaskCard, type DragAction } from './taskCard';

export function TaskKanbanCard({
  card, assigneeName, onAction, onOpen, highlight = false, unreadComments = 0,
}: {
  card: TaskCard;
  assigneeName: string;
  onAction: (action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  highlight?: boolean;
  unreadComments?: number;
}) {
  const { t } = useTranslation('common');
  const draggable = isDraggable(card, unreadComments > 0);
  // Resolve/Reopen is gated on assignment, not drag: a card parked in Replies is
  // non-draggable but its owner must still be able to act on it (spec line ~36).
  const canAct = card.relation === 'mine';
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
            {t('tasks_page.assigned_to', { name: assigneeName })}
          </span>
        )}
        {startedBadgeVisible({ resolved: card.resolved, startedAt: card.startedAtIso }) && (
          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200">
            {t('tasks_page.started_short')}
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
