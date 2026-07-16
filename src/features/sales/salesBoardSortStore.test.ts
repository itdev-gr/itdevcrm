import { beforeEach, describe, expect, it } from 'vitest';
import { useSalesBoardSortStore } from './salesBoardSortStore';

const STORAGE_KEY = 'itdevcrm-sales-board-sort-v1';

beforeEach(() => {
  localStorage.clear();
  useSalesBoardSortStore.setState({ byUser: {} });
});

describe('salesBoardSortStore', () => {
  it('defaults to newest for an unknown user', () => {
    expect(useSalesBoardSortStore.getState().getSortBy('unknown-user')).toBe('newest');
  });

  it('round-trips a set value through getSortBy', () => {
    useSalesBoardSortStore.getState().setSortBy('user-a', 'oldest');
    expect(useSalesBoardSortStore.getState().getSortBy('user-a')).toBe('oldest');
  });

  it('keeps each user isolated (A does not leak to B)', () => {
    useSalesBoardSortStore.getState().setSortBy('user-a', 'value_high');
    useSalesBoardSortStore.getState().setSortBy('user-b', 'value_low');
    expect(useSalesBoardSortStore.getState().getSortBy('user-a')).toBe('value_high');
    expect(useSalesBoardSortStore.getState().getSortBy('user-b')).toBe('value_low');
    // An untouched user still falls back to the default.
    expect(useSalesBoardSortStore.getState().getSortBy('user-c')).toBe('newest');
  });

  it('persists the choice to localStorage under the versioned key', () => {
    useSalesBoardSortStore.getState().setSortBy('user-a', 'recent');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.byUser['user-a']).toBe('recent');
  });
});
