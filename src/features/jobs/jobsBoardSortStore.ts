import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortBy } from './kanbanGrouping';
import type { ServiceType } from './hooks/useJobs';

// Per-user, per-board sort preference for the jobs kanban — persists across
// reloads via localStorage. Key: `${userId}:${board}`.

export function getBoardSortKey(userId: string, board: ServiceType): string {
  return `${userId}:${board}`;
}

type State = {
  byUserBoard: Record<string, SortBy>;
  getSortBy: (userId: string, board: ServiceType) => SortBy;
  setSortBy: (userId: string, board: ServiceType, sortBy: SortBy) => void;
};

export const useJobsBoardSortStore = create<State>()(
  persist(
    (set, get) => ({
      byUserBoard: {},
      getSortBy: (userId, board) =>
        get().byUserBoard[getBoardSortKey(userId, board)] ?? 'newest',
      setSortBy: (userId, board, sortBy) =>
        set((s) => ({
          byUserBoard: { ...s.byUserBoard, [getBoardSortKey(userId, board)]: sortBy },
        })),
    }),
    {
      name: 'itdevcrm-jobs-board-sort-v1',
      partialize: (s) => ({ byUserBoard: s.byUserBoard }),
    },
  ),
);
