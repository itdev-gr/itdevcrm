import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useAuthStore } from '@/lib/stores/authStore';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { SegmentedControl } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useTaskBoardData, isoDaysAgo } from './hooks/useTaskBoardData';
import { useTaskBoardActions } from './hooks/useTaskBoardActions';
import { TasksKanbanColumn } from './TasksKanbanColumn';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';
import { UserTaskDetailDialog } from './UserTaskDetailDialog';
import {
  BOARD_COLUMNS, buildBoardCards, columnOf, matchesFilter, resolveDrag,
  type BoardFilter, type ColumnKey, type TaskCard, type DragAction,
} from './taskCard';

const RESOLVED_WINDOW_DAYS = 30;

export function TasksKanbanBoard() {
  const { t } = useTranslation('common');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [allTeam, setAllTeam] = useState(false);
  const [filter, setFilter] = useState<BoardFilter>('to_me');
  const [activeCard, setActiveCard] = useState<TaskCard | null>(null);
  // Track the open dialog by key, not a frozen snapshot, so the detail dialog
  // reflects live changes (e.g. started_at) after the board query refetches.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cutoffIso] = useState(() => isoDaysAgo(RESOLVED_WINDOW_DAYS));

  // Resolve assignee names from the full staff directory so service-team
  // assignees (local_seo/web_seo/…) display, not just sales-only owners.
  const { data: owners = [] } = useMentionableUsers();
  const nameById = useMemo(() => new Map(owners.map((o) => [o.user_id, o.full_name || o.email])), [owners]);
  const nameFor = (id: string) => nameById.get(id) ?? '—';

  const { userRows, assignedRows, isLoading } = useTaskBoardData({ meId, allTeam: isAdmin && allTeam, cutoffIso });
  const apply = useTaskBoardActions();

  const cards = useMemo(
    () => buildBoardCards(userRows, assignedRows, meId),
    [userRows, assignedRows, meId],
  );

  const byColumn = useMemo(() => {
    const map = new Map<ColumnKey, TaskCard[]>(BOARD_COLUMNS.map((c) => [c, []]));
    for (const card of cards) {
      if (matchesFilter(card, filter)) map.get(columnOf(card))!.push(card);
    }
    return map;
  }, [cards, filter]);

  // Live card behind the open dialog (re-derived each render from fresh rows).
  const openCard = openKey ? (cards.find((c) => c.key === openKey) ?? null) : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveCard((e.active.data.current as { card?: TaskCard } | undefined)?.card ?? null);
  }
  function fire(card: TaskCard, action: DragAction) {
    if (action.type !== 'noop') apply.mutate({ card, action });
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const card = (e.active.data.current as { card?: TaskCard } | undefined)?.card;
    const target = e.over ? (String(e.over.id) as ColumnKey) : null;
    if (!card || !target) return;
    fire(card, resolveDrag(card, target));
  }

  const columnLabel = (c: ColumnKey) => (c === 'resolved' ? t('tasks_page.column_resolved') : t(`importance.${c}`));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v as BoardFilter)}
          options={[
            { value: 'to_me', label: t('tasks_page.filter_to_me') },
            { value: 'by_me', label: t('tasks_page.filter_by_me') },
            { value: 'all', label: t('tasks_page.filter_all') },
          ]}
        />
        {isAdmin && (
          <button
            type="button"
            onClick={() => setAllTeam((v) => !v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              allTeam
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {t('tasks_page.all_team')}
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="p-8 text-center text-sm text-muted-foreground">…</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveCard(null)}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
            {BOARD_COLUMNS.map((c) => (
              <TasksKanbanColumn
                key={c}
                column={c}
                label={columnLabel(c)}
                cards={byColumn.get(c) ?? []}
                nameFor={nameFor}
                onAction={fire}
                onOpen={(card) => setOpenKey(card.key)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="rounded-lg border bg-background px-3 py-2 text-sm font-medium shadow-md">
                {activeCard.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {openCard?.kind === 'assigned' && (
        <AssignedTaskDetailDialog taskId={openCard.id} onOpenChange={(o) => !o && setOpenKey(null)} />
      )}
      {openCard?.kind === 'user' && (
        <UserTaskDetailDialog
          card={openCard}
          creatorName={openCard.creatorId ? nameFor(openCard.creatorId) : null}
          onOpenChange={(o) => !o && setOpenKey(null)}
        />
      )}
    </div>
  );
}
