import { importanceOf, type ImportanceCode } from './importance';
import type { DualResolveState } from './dualResolve';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import type { AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';

/** Dual-resolve side stamps that ride on the task rows. Optional here because
 *  some list selects use `select('*')` (columns present at runtime but not in
 *  the generated `UserTaskRow` type) and some non-board callers omit them. */
export type TaskSideStamps = {
  creator_resolved_at?: string | null;
  assignee_resolved_at?: string | null;
  summary?: string | null;
};

export type TaskRelation = 'mine' | 'delegated' | 'other';
export type ColumnKey = ImportanceCode | 'resolved' | 'replies';
export type BoardFilter = 'to_me' | 'by_me' | 'all';

export type TaskLeadJoin = { id: string; title: string; code: string | null };
export type TaskClientJoin = { id: string; name: string };

/** Left→right column order on the board. Replies is derived (foreign comments
 *  on open party tasks), not a stored state — see columnOf. */
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
  clientId: string | null;
  leadName: string | null;
  // Dual-resolve: per-side stamps + the AI resolve-summary (null until filled).
  creatorResolvedAt: string | null;
  assigneeResolvedAt: string | null;
  summary: string | null;
  // Under Development cadence: a chain task closes with an outcome, not a
  // plain resolve (the DB rejects outcome-less completion). Optional so the
  // many non-cadence card factories (and test fixtures) stay untouched.
  leadId?: string | null;
  cadenceRunId?: string | null;
};

/** Build the pure dual-resolve state a card carries, for `resolveAction` /
 *  `awaitingLabelParty`. `closed` mirrors the terminal state (`resolved`). */
export function cardDualResolveState(card: TaskCard): DualResolveState {
  return {
    creatorResolvedAt: card.creatorResolvedAt,
    assigneeResolvedAt: card.assigneeResolvedAt,
    creatorId: card.creatorId,
    assigneeId: card.assigneeId,
    closed: card.resolved,
  };
}

export function relationOf(assigneeId: string, creatorId: string | null, meId: string): TaskRelation {
  if (assigneeId === meId) return 'mine';
  if (creatorId && creatorId === meId) return 'delegated';
  return 'other';
}

export function userTaskToCard(
  row: UserTaskRow & TaskSideStamps & { lead?: TaskLeadJoin | null; client?: TaskClientJoin | null },
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
    // Fall back to the raw column so the id survives even without the join.
    clientName: row.client?.name ?? null,
    clientId: row.client?.id ?? row.client_id ?? null,
    leadName: row.lead?.title ?? null,
    creatorResolvedAt: row.creator_resolved_at ?? null,
    assigneeResolvedAt: row.assignee_resolved_at ?? null,
    summary: row.summary ?? null,
    leadId: row.lead?.id ?? row.lead_id ?? null,
    cadenceRunId: row.cadence_run_id ?? null,
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
    clientId: row.client_id ?? null,
    leadName: null,
    creatorResolvedAt: row.creator_resolved_at ?? null,
    assigneeResolvedAt: row.assignee_resolved_at ?? null,
    summary: row.summary ?? null,
    leadId: null,
    cadenceRunId: null,
  };
}

/** True when the viewer's own side of the dual-resolve is stamped. The card's
 *  `relation` already encodes the viewer ('mine' = assignee, 'delegated' =
 *  creator); 'other' (admin observer) has no side. */
export function viewerSideStamped(card: TaskCard): boolean {
  if (card.relation === 'mine') return card.assigneeResolvedAt != null;
  if (card.relation === 'delegated') return card.creatorResolvedAt != null;
  return false;
}

/** Column placement, viewer-relative. Precedence: terminal (resolved) > unread
 *  replies > my own dual-resolve stamp > importance. A truly-closed task rests
 *  in Resolved even while discussed; an open card whose *my* side is stamped is
 *  finished FOR ME so it parks in Resolved while it awaits the other party —
 *  but an unread reply resurfaces it. `hasUnreadReplies` is optional so
 *  non-board callers (client/lead tabs) keep legacy behavior. */
export function columnOf(card: TaskCard, hasUnreadReplies = false): ColumnKey {
  if (card.resolved) return 'resolved';
  if (hasUnreadReplies) return 'replies';
  if (viewerSideStamped(card)) return 'resolved';
  return card.importance;
}

/** A task is draggable by either party — the assignee ('mine') OR the creator
 *  ('delegated'), so the creator can also drag-to-stamp their side of a
 *  dual-resolve task. Cards in Replies drag like any other card. */
export function isDraggable(card: TaskCard): boolean {
  return card.relation === 'mine' || card.relation === 'delegated';
}

export function buildBoardCards(userRows: Array<UserTaskRow & { lead?: TaskLeadJoin | null; client?: TaskClientJoin | null }>, assignedRows: AssignedTaskRow[], meId: string): TaskCard[] {
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
  | { type: 'withdraw'; importance: ImportanceCode }
  | { type: 'reopen'; importance: ImportanceCode };

/** Decide what dropping `card` onto column `target` should do. */
export function resolveDrag(card: TaskCard, target: ColumnKey): DragAction {
  if (target === 'replies') return { type: 'noop' };
  if (!isDraggable(card)) return { type: 'noop' };
  if (target === 'resolved') {
    // Terminal, or my side already stamped → already sits in Resolved for me.
    if (card.resolved || viewerSideStamped(card)) return { type: 'noop' };
    return { type: 'resolve' };
  }
  if (card.resolved) return { type: 'reopen', importance: target };
  // Open card leaving MY Resolved column = withdraw my stamp (+ new priority).
  if (viewerSideStamped(card)) return { type: 'withdraw', importance: target };
  if (card.importance === target) return { type: 'noop' };
  return { type: 'set-importance', importance: target };
}
