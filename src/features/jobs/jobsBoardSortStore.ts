import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortBy } from './kanbanGrouping';
import type { ServiceType } from './hooks/useJobs';

export function getBoardSortKey(userId: string, board: ServiceType): string {
  return `${userId}:${board}`;
}

type State = {
  byUserBoard: Record<string, SortBy>;
  get: (userId: string, board: ServiceType) => SortBy;
  set: (userId: string, board: ServiceType, sortBy: SortBy) => void;
};

export const useJobsBoardSortStore = create<State>()(
  persist(
    (set, get) => ({
      byUserBoard: {},
      get: (userId, board) => get().byUserBoard[getBoardSortKey(userId, board)] ?? 'newest',
      set: (userId, board, sortBy) =>
        set((s) => ({
          byUserBoard: { ...s.byUserBoard, [getBoardSortKey(userId, board)]: sortBy },
        })),
    }),
    { name: 'itdevcrm-jobs-board-sort-v1' },
  ),
);
