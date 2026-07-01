import { beforeEach, describe, it, expect } from 'vitest';
import { useJobsBoardSortStore, getBoardSortKey } from './jobsBoardSortStore';

describe('jobsBoardSortStore', () => {
  beforeEach(() => {
    // Reset the zustand store between tests.
    useJobsBoardSortStore.setState({ byUserBoard: {} });
    window.localStorage.clear();
  });

  it('defaults to newest when nothing is stored', () => {
    const state = useJobsBoardSortStore.getState();
    expect(state.get('user-1', 'local_seo')).toBe('newest');
  });

  it('stores a value under a user+board composite key', () => {
    const state = useJobsBoardSortStore.getState();
    state.set('user-1', 'local_seo', 'recent');
    expect(useJobsBoardSortStore.getState().get('user-1', 'local_seo')).toBe('recent');
  });

  it('keeps independent values per user and per board', () => {
    const state = useJobsBoardSortStore.getState();
    state.set('user-1', 'local_seo', 'oldest');
    state.set('user-1', 'web_seo', 'stale');
    state.set('user-2', 'local_seo', 'recent');
    const s = useJobsBoardSortStore.getState();
    expect(s.get('user-1', 'local_seo')).toBe('oldest');
    expect(s.get('user-1', 'web_seo')).toBe('stale');
    expect(s.get('user-2', 'local_seo')).toBe('recent');
  });

  it('exposes a composite key helper', () => {
    expect(getBoardSortKey('user-1', 'local_seo')).toBe('user-1:local_seo');
  });
});
