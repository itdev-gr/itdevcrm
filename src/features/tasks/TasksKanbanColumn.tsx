import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { TaskKanbanCard } from './TaskKanbanCard';
import type { ColumnKey, TaskCard, DragAction } from './taskCard';

export function TasksKanbanColumn({
  column, label, cards, nameFor, onAction, onOpen, isNew, unreadCount,
}: {
  column: ColumnKey;
  label: string;
  cards: TaskCard[];
  nameFor: (id: string) => string;
  onAction: (card: TaskCard, action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  isNew?: (card: TaskCard) => boolean;
  unreadCount?: (card: TaskCard) => number;
}) {
  const { t } = useTranslation('common');
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <div
      ref={setNodeRef}
      data-testid={`tasks-col-${column}`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl bg-card shadow-sm ring-1 ring-border/60',
        isOver && 'ring-primary/40',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="truncate text-sm font-semibold">{label}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{cards.length}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            {t('tasks_page.board_empty')}
          </p>
        ) : (
          cards.map((c) => (
            <TaskKanbanCard
              key={c.key}
              card={c}
              nameFor={nameFor}
              onAction={(a) => onAction(c, a)}
              onOpen={onOpen}
              highlight={isNew?.(c) ?? false}
              unreadComments={unreadCount?.(c) ?? 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
