import { create } from 'zustand';

// In-memory mirror of the sales board's active column filter (owner / source /
// search) so the lead detail page's "Next in stage" walks the SAME rows the
// board shows, in the same order — not the whole stage. NOT persisted: it only
// needs to survive the in-session board -> lead navigation (the SPA doesn't
// reload). On a fresh page load it starts empty and Next falls back to the full
// RLS-scoped stage until the user touches the board again. Keyed by userId —
// there is one sales board per user (mirrors salesBoardSortStore).

export type SalesBoardFilter = {
  ownerId?: string;
  source?: 'manual' | 'meta' | 'import';
  search: string;
};

type State = {
  byUser: Record<string, SalesBoardFilter>;
  setFilter: (userId: string, filter: SalesBoardFilter) => void;
};

export const EMPTY_SALES_BOARD_FILTER: SalesBoardFilter = { search: '' };

export const useSalesBoardFilterStore = create<State>((set) => ({
  byUser: {},
  setFilter: (userId, filter) =>
    set((s) => ({ byUser: { ...s.byUser, [userId]: filter } })),
}));
