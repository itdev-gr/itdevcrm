import type { TaskCard } from './taskCard';

/** Slim task_comments row: only the two task-id columns the index needs. */
export type TaskCommentIdRow = {
  user_task_id: string | null;
  assigned_task_id: string | null;
};

/** Split ids into `.in()`-sized chunks (PostgREST URL-length safety). */
export function chunkIds(ids: string[], size = 100): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/** Board card keys (`user:<id>` / `assigned:<id>`) present in comment rows. */
export function foreignCommentKeys(rows: TaskCommentIdRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.user_task_id) keys.add(`user:${row.user_task_id}`);
    if (row.assigned_task_id) keys.add(`assigned:${row.assigned_task_id}`);
  }
  return keys;
}

/** Replies-eligible cards: OPEN tasks the viewer is a party to (assignee or
 *  creator). Resolved tasks and relation 'other' never enter Replies. Sorted
 *  so the caller can reuse the lists in a stable query key. */
export function replyCandidateIds(cards: TaskCard[]): { userIds: string[]; assignedIds: string[] } {
  const userIds: string[] = [];
  const assignedIds: string[] = [];
  for (const c of cards) {
    if (c.resolved || (c.relation !== 'mine' && c.relation !== 'delegated')) continue;
    (c.kind === 'user' ? userIds : assignedIds).push(c.id);
  }
  return { userIds: userIds.sort(), assignedIds: assignedIds.sort() };
}
