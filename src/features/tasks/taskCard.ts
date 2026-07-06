import { importanceOf, type ImportanceCode } from './importance';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import type { AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';

export type TaskRelation = 'mine' | 'delegated' | 'other';
export type ColumnKey = ImportanceCode | 'resolved' | 'replies';
export type BoardFilter = 'to_me' | 'by_me' | 'all';

export type TaskLeadJoin = { id: string; title: string; code: string | null };

/** Left→right column order on the board. Replies is derived (unread comment
 *  notifications), not a stored state — see columnOf. */
export const BOARD_COLUMNS: ColumnKey[] = ['replies', 'urgent', 'high', 'medium', 'low', 'resolved'];

export type TaskCard = {
  key: string;            // 'user:<id>' | 'assigned:<id>'
  kind: 'user' | 'assigned';
  id: string;
  title: string;
  importance: ImportanceCode;
  relation: TaskRelation; // mine = I'm the assignee
  resolved: boolean;
  assigneeId: string;
  creatorId: string | null;
  createdAtIso: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  startedAtIso: string | null;
  sourceCode: string | null;
  link: string | null;    // deal/job link, or null for personal
  notes: string | null;
  clientName: string | null;
  leadName: string | null;
};

export function relationOf(assigneeId: string, creatorId: string | null, meId: string): TaskRelation {
  if (assigneeId === meId) return 'mine';
  if (creatorId && creatorId === meId) return 'delegated';
  return 'other';
}

export function userTaskToCard(
  row: UserTaskRow & { lead?: TaskLeadJoin | null },
  meId: string,
): TaskCard {
  const creatorId = row.created_by ?? null;
  return {
    key: `user:${row.id}`,
    kind: 'user',
    id: row.id,
    title: row.title,
    importance: importanceOf(row),
    relation: relationOf(row.user_id, creatorId, meId),
    resolved: row.completed_at != null,
    assigneeId: row.user_id,
    creatorId,
    createdAtIso: row.created_at ?? null,
    dueAt: row.due_at ?? null,
    resolvedAt: row.completed_at ?? null,
    startedAtIso: row.started_at ?? null,
    sourceCode: row.lead?.code ?? null,
    link: row.lead ? `/leads/${row.lead.id}` : null,
    notes: row.notes ?? null,
    clientName: null,
    leadName: row.lead?.title ?? null,
  };
}

export function assignedTaskToCard(row: AssignedTaskRow, meId: string): TaskCard {
  const link = row.deal_id ? `/deals/${row.deal_id}` : row.job_id ? `/jobs/${row.job_id}` : null;
  return {
    key: `assigned:${row.id}`,
    kind: 'assigned',
    id: row.id,
    title: row.title,
    importance: importanceOf(row),
    relation: relationOf(row.assignee_user_id, row.created_by_user_id, meId),
    resolved: row.status === 'resolved',
    assigneeId: row.assignee_user_id,
    creatorId: row.created_by_user_id,
    createdAtIso: row.created_at ?? null,
    dueAt: null,
    resolvedAt: row.resolved_at ?? null,
    startedAtIso: row.started_at ?? null,
    sourceCode: row.source_code,
    link,
    notes: row.description ?? null,
    clientName: row.client?.name ?? null,
    leadName: null,
  };
}

/** hasUnreadReplies (derived from unread comment notifications) wins over
 *  everything — including resolved, so a reply resurfaces a resolved task.
 *  Optional so non-board callers (client/lead tabs) keep legacy behavior. */
export function columnOf(card: TaskCard, hasUnreadReplies = false): ColumnKey {
  if (hasUnreadReplies) return 'replies';
  return card.resolved ? 'resolved' : card.importance;
}

/** Only tasks where I'm the assignee can be moved/resolved from my board.
 *  Cards sitting in Replies are read-first: not draggable until opened. */
export function isDraggable(card: TaskCard, hasUnreadReplies = false): boolean {
  return card.relation === 'mine' && !hasUnreadReplies;
}

export function buildBoardCards(userRows: Array<UserTaskRow & { lead?: TaskLeadJoin | null }>, assignedRows: AssignedTaskRow[], meId: string): TaskCard[] {
  return [
    ...userRows.map((r) => userTaskToCard(r, meId)),
    ...assignedRows.map((r) => assignedTaskToCard(r, meId)),
  ];
}

export function matchesFilter(card: TaskCard, filter: BoardFilter): boolean {
  if (filter === 'to_me') return card.relation === 'mine';
  if (filter === 'by_me') return card.relation === 'delegated';
  return true;
}

export type DragAction =
  | { type: 'noop' }
  | { type: 'set-importance'; importance: ImportanceCode }
  | { type: 'resolve' }
  | { type: 'reopen'; importance: ImportanceCode };

/** Decide what dropping `card` onto column `target` should do. */
export function resolveDrag(card: TaskCard, target: ColumnKey): DragAction {
  if (target === 'replies') return { type: 'noop' };
  if (!isDraggable(card)) return { type: 'noop' };
  if (target === 'resolved') {
    return card.resolved ? { type: 'noop' } : { type: 'resolve' };
  }
  if (card.resolved) return { type: 'reopen', importance: target };
  if (card.importance === target) return { type: 'noop' };
  return { type: 'set-importance', importance: target };
}
