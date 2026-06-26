import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Per-user, per-device task state in localStorage:
//  - seenByUser: when the user last opened the Tasks page (sidebar "new" badge).
//  - openedByUser: which individual tasks the user has opened (for the new-task
//    highlight — a task stays highlighted until opened).
type TasksSeenState = {
  seenByUser: Record<string, string>;
  markSeen: (userId: string, iso: string) => void;
  openedByUser: Record<string, Record<string, true>>;
  markOpened: (userId: string, taskId: string) => void;
};

export const useTasksSeenStore = create<TasksSeenState>()(
  persist(
    (set) => ({
      seenByUser: {},
      markSeen: (userId, iso) =>
        set((s) => ({ seenByUser: { ...s.seenByUser, [userId]: iso } })),
      openedByUser: {},
      markOpened: (userId, taskId) =>
        set((s) => ({
          openedByUser: {
            ...s.openedByUser,
            [userId]: { ...(s.openedByUser[userId] ?? {}), [taskId]: true },
          },
        })),
    }),
    { name: 'itdevcrm-tasks-seen-v1' },
  ),
);
