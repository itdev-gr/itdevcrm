import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortBy } from './salesKanbanColumns';

// Per-user sort preference for the sales kanban — persists across reloads via
// localStorage so opening a lead and coming back keeps the chosen order. There
// is only one sales board, so the key is the userId alone.

type State = {
  byUser: Record<string, SortBy>;
  getSortBy: (userId: string) => SortBy;
  setSortBy: (userId: string, sortBy: SortBy) => void;
};

export const useSalesBoardSortStore = create<State>()(
  persist(
    (set, get) => ({
      byUser: {},
      getSortBy: (userId) => get().byUser[userId] ?? 'newest',
      setSortBy: (userId, sortBy) =>
        set((s) => ({ byUser: { ...s.byUser, [userId]: sortBy } })),
    }),
    {
      name: 'itdevcrm-sales-board-sort-v1',
      partialize: (s) => ({ byUser: s.byUser }),
    },
  ),
);
