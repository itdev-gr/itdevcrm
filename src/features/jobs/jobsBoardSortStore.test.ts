import { beforeEach, describe, it, expect } from 'vitest';
import { useJobsBoardSortStore, getBoardSortKey } from './jobsBoardSortStore';

describe('jobsBoardSortStore', () => {
  beforeEach(() => {
    // Reset both the in-memory zustand slot AND the persisted layer so each
    // test starts fresh.
    useJobsBoardSortStore.setState({ byUserBoard: {} });
    window.localStorage.clear();
  });

  it('defaults to newest when nothing is stored', () => {
    const state = useJobsBoardSortStore.getState();
    expect(state.getSortBy('user-1', 'local_seo')).toBe('newest');
  });

  it('stores a value under a user+board composite key', () => {
    const state = useJobsBoardSortStore.getState();
    state.setSortBy('user-1', 'local_seo', 'recent');
    expect(useJobsBoardSortStore.getState().getSortBy('user-1', 'local_seo')).toBe('recent');
  });

  it('keeps independent values per user and per board', () => {
    const state = useJobsBoardSortStore.getState();
    state.setSortBy('user-1', 'local_seo', 'oldest');
    state.setSortBy('user-1', 'web_seo', 'stale');
    state.setSortBy('user-2', 'local_seo', 'recent');
    const s = useJobsBoardSortStore.getState();
    expect(s.getSortBy('user-1', 'local_seo')).toBe('oldest');
    expect(s.getSortBy('user-1', 'web_seo')).toBe('stale');
    expect(s.getSortBy('user-2', 'local_seo')).toBe('recent');
  });

  it('exposes a composite key helper', () => {
    expect(getBoardSortKey('user-1', 'local_seo')).toBe('user-1:local_seo');
  });

  it('persists the choice under itdevcrm-jobs-board-sort-v1', () => {
    useJobsBoardSortStore.getState().setSortBy('user-1', 'local_seo', 'recent');
    const raw = window.localStorage.getItem('itdevcrm-jobs-board-sort-v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.byUserBoard['user-1:local_seo']).toBe('recent');
  });
});
