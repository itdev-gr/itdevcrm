import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useTasksSeenStore } from './tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from './taskHighlight';
import { TasksKanbanColumn } from './TasksKanbanColumn';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';
import { UserTaskDetailDialog } from './UserTaskDetailDialog';
import { useUnreadCommentNotifs } from '@/features/notifications/hooks/useUnreadCommentNotifs';
import { useMarkNotificationsRead } from '@/features/notifications/hooks/useMarkNotificationsRead';
import { unreadCommentIndex } from './commentBadge';
import { awaitingPopupKey } from './dualResolve';
import {
  BOARD_COLUMNS, buildBoardCards, columnOf, matchesFilter, resolveDrag,
  type BoardFilter, type ColumnKey, type TaskCard, type DragAction,
} from './taskCard';

const RESOLVED_WINDOW_DAYS = 30;
const EMPTY_OPENED: Record<string, true> = {};

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

  // New-task highlight: a task stays highlighted until the viewer opens it.
  const opened = useTasksSeenStore((s) => s.openedByUser[meId] ?? EMPTY_OPENED);
  const markOpened = useTasksSeenStore((s) => s.markOpened);
  const [highlightCutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);
  const isNew = (card: TaskCard) =>
    isTaskHighlighted({ createdAtIso: card.createdAtIso, opened: !!opened[card.id], cutoffMs: highlightCutoffMs });

  // Resolve assignee names from the full staff directory so service-team
  // assignees (local_seo/web_seo/…) display, not just sales-only owners.
  const { data: owners = [] } = useMentionableUsers();
  const nameById = useMemo(() => new Map(owners.map((o) => [o.user_id, o.full_name || o.email])), [owners]);
  const nameFor = (id: string) => nameById.get(id) ?? '—';

  const { userRows, assignedRows, isLoading } = useTaskBoardData({ meId, allTeam: isAdmin && allTeam, cutoffIso });
  const apply = useTaskBoardActions();

  // Unread-comment badge: derived from unread task_comment bell notifications.
  const { data: unreadNotifs = [] } = useUnreadCommentNotifs();
  const { mutate: markCommentsRead } = useMarkNotificationsRead();
  const commentIndex = useMemo(() => unreadCommentIndex(unreadNotifs), [unreadNotifs]);

  const cards = useMemo(
    () => buildBoardCards(userRows, assignedRows, meId),
    [userRows, assignedRows, meId],
  );

  const byColumn = useMemo(() => {
    const map = new Map<ColumnKey, TaskCard[]>(BOARD_COLUMNS.map((c) => [c, []]));
    for (const card of cards) {
      const hasUnread = (commentIndex.get(card.key)?.count ?? 0) > 0;
      if (matchesFilter(card, filter)) map.get(columnOf(card, hasUnread))!.push(card);
    }
    return map;
  }, [cards, filter, commentIndex]);

  // Live card behind the open dialog (re-derived each render from fresh rows).
  const openCard = openKey ? (cards.find((c) => c.key === openKey) ?? null) : null;

  // Shared open handler for both paths (card click + deep link): clear the
  // new-task highlight and open the dialog. Marking comment notifications read
  // is handled by the effect below so it also covers notifs that resolve late.
  const openCardByKey = useCallback((card: TaskCard) => {
    if (meId) markOpened(meId, card.id);
    setOpenKey(card.key);
  }, [meId, markOpened]);

  // While a task's dialog is open its comment thread is on screen — clear its
  // unread comment notifications, including ones that resolve or arrive late.
  useEffect(() => {
    if (!openKey) return;
    const unread = commentIndex.get(openKey);
    if (unread) markCommentsRead(unread.notifIds);
  }, [openKey, commentIndex, markCommentsRead]);

  // Deep-link: ?open=<kind>:<id> opens the matching card's dialog once. We
  // strip the param after consuming it so closing the dialog doesn't reopen
  // it on the next render. Notifications use this to land service-team users
  // directly on their task without crashing through the deal/job page (which
  // RLS may hide from them).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const raw = searchParams.get('open');
    if (!raw) return;
    const card = cards.find((c) => c.key === raw);
    if (!card) return;
    openCardByKey(card);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, cards, setSearchParams, openCardByKey]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveCard((e.active.data.current as { card?: TaskCard } | undefined)?.card ?? null);
  }
  function fire(card: TaskCard, action: DragAction) {
    if (action.type === 'noop') return;
    apply.mutate(
      { card, action },
      {
        onSuccess: (res) => {
          // A resolve that only stamped the caller's side (task still awaits the
          // other party) — tell the user; the card stays in its column because
          // the terminal state is unchanged.
          if (action.type === 'resolve' && res && !res.closed) {
            window.alert(t(awaitingPopupKey(res.your_side)));
          }
        },
      },
    );
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const card = (e.active.data.current as { card?: TaskCard } | undefined)?.card;
    const target = e.over ? (String(e.over.id) as ColumnKey) : null;
    if (!card || !target) return;
    fire(card, resolveDrag(card, target));
  }

  const columnLabel = (c: ColumnKey) =>
    c === 'resolved' ? t('tasks_page.column_resolved')
    : c === 'replies' ? t('tasks_page.column_replies')
    : t(`importance.${c}`);

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
                onOpen={openCardByKey}
                isNew={isNew}
                unreadCount={(c) => commentIndex.get(c.key)?.count ?? 0}
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
          assigneeName={nameFor(openCard.assigneeId)}
          onOpenChange={(o) => !o && setOpenKey(null)}
        />
      )}
    </div>
  );
}
