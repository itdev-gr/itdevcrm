import { describe, it, expect, beforeEach } from 'vitest';
import { useSalesBoardFilterStore, EMPTY_SALES_BOARD_FILTER } from './salesBoardFilterStore';

describe('salesBoardFilterStore', () => {
  beforeEach(() => {
    useSalesBoardFilterStore.setState({ byUser: {} });
  });

  it('starts empty and stores a per-user filter', () => {
    expect(useSalesBoardFilterStore.getState().byUser).toEqual({});
    useSalesBoardFilterStore.getState().setFilter('u1', { source: 'meta', search: 'papa' });
    expect(useSalesBoardFilterStore.getState().byUser['u1']).toEqual({ source: 'meta', search: 'papa' });
  });

  it('keeps each user isolated and overwrites on re-set', () => {
    const { setFilter } = useSalesBoardFilterStore.getState();
    setFilter('u1', { ownerId: 'u1', search: '' });
    setFilter('u2', { search: 'x' });
    setFilter('u1', { search: 'new' }); // overwrite u1
    const { byUser } = useSalesBoardFilterStore.getState();
    expect(byUser['u1']).toEqual({ search: 'new' });
    expect(byUser['u2']).toEqual({ search: 'x' });
  });

  it('exposes a stable empty default for the lead page fallback', () => {
    expect(EMPTY_SALES_BOARD_FILTER).toEqual({ search: '' });
  });
});
