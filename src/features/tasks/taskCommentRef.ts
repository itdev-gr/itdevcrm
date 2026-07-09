export type TaskRef = { kind: 'assigned' | 'user'; id: string };

const KEY_RE =
  /^(assigned|user):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Parse a comments.task_key back-reference; null for anything malformed. */
export function parseTaskKey(key: string | null | undefined): TaskRef | null {
  if (!key) return null;
  const m = KEY_RE.exec(key);
  return m ? { kind: m[1] as TaskRef['kind'], id: m[2]! } : null;
}
