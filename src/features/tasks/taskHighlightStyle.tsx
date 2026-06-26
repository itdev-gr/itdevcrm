/** Amber ring for kanban cards. */
export const NEW_TASK_RING = 'ring-2 ring-amber-400/70 dark:ring-amber-500/60';
/** Subtle amber tint for list rows. */
export const NEW_TASK_ROW = 'bg-amber-50 dark:bg-amber-950/20';

/** Small amber "new" dot shown next to a new task's title. */
export function NewTaskDot() {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full bg-amber-500"
      aria-label="new"
      title="New"
    />
  );
}
