import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Tracks, per user, when they last opened the Tasks page — so the sidebar can
// show how many tasks arrived since. Persisted to localStorage (per device).
type TasksSeenState = {
  seenByUser: Record<string, string>;
  markSeen: (userId: string, iso: string) => void;
};

export const useTasksSeenStore = create<TasksSeenState>()(
  persist(
    (set) => ({
      seenByUser: {},
      markSeen: (userId, iso) =>
        set((s) => ({ seenByUser: { ...s.seenByUser, [userId]: iso } })),
    }),
    { name: 'itdevcrm-tasks-seen-v1' },
  ),
);
