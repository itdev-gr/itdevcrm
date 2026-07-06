export type UnreadCommentNotif = { id: string; payload: Record<string, unknown> };
export type UnreadCommentEntry = { count: number; notifIds: string[] };

const KIND_MAP: Record<string, 'user' | 'assigned'> = {
  user_task: 'user',
  assigned_task: 'assigned',
};

/** Group unread task_comment notifications by board card key (`<kind>:<task_id>`),
 *  matching TaskCard.key. Malformed payloads are skipped. */
export function unreadCommentIndex(rows: UnreadCommentNotif[]): Map<string, UnreadCommentEntry> {
  const map = new Map<string, UnreadCommentEntry>();
  for (const row of rows) {
    const kind = KIND_MAP[String(row.payload['task_kind'] ?? '')];
    const taskId = row.payload['task_id'];
    if (!kind || typeof taskId !== 'string' || !taskId) continue;
    const key = `${kind}:${taskId}`;
    const entry = map.get(key) ?? { count: 0, notifIds: [] };
    entry.count += 1;
    entry.notifIds.push(row.id);
    map.set(key, entry);
  }
  return map;
}
