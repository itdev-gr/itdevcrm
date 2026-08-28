import { describe, it, expect } from 'vitest';
import {
  KANBAN_PAGE_SIZE,
  KANBAN_SEARCH_COLUMNS,
  normalizeSearchTerm,
  orderForSort,
  pickNextId,
  searchOrClause,
} from './salesKanbanColumns';

describe('salesKanbanColumns', () => {
  it('maps every sort option to a server order clause', () => {
    expect(orderForSort('newest')).toEqual({ column: 'created_at', ascending: false });
    expect(orderForSort('oldest')).toEqual({ column: 'created_at', ascending: true });
    expect(orderForSort('recent')).toEqual({ column: 'updated_at', ascending: false });
    expect(orderForSort('value_high')).toEqual({ column: 'estimated_total_value', ascending: false });
    expect(orderForSort('value_low')).toEqual({ column: 'estimated_total_value', ascending: true });
  });

  it('builds an ilike OR clause across the searchable fields', () => {
    expect(searchOrClause('   ')).toBeNull();
    const c = searchOrClause('acme');
    expect(c).toContain('title.ilike.%acme%');
    expect(c).toContain('phone.ilike.%acme%');
    // one `<column>.ilike.%term%` per searchable column, nothing else
    expect(c?.split(',')).toEqual(KANBAN_SEARCH_COLUMNS.map((col) => `${col}.ilike.%acme%`));
  });

  it('matches the lead code so "006250" finds lead 006250 in the kanban', () => {
    expect(KANBAN_SEARCH_COLUMNS).toContain('code');
    expect(searchOrClause('006250')).toContain('code.ilike.%006250%');
    // parity with the lead typeahead (useLeadSearch): business profile + VAT too
    expect(KANBAN_SEARCH_COLUMNS).toContain('business_profile_name');
    expect(KANBAN_SEARCH_COLUMNS).toContain('vat_number');
  });

  it('strips PostgREST-breaking characters from the search term', () => {
    const c = searchOrClause('a,b(c)%');
    expect(c).toContain('title.ilike.%a b c%');
  });

  it('normalizeSearchTerm strips % , ( ) and trims', () => {
    expect(normalizeSearchTerm('Acme, Ltd')).toBe('Acme  Ltd');
    expect(normalizeSearchTerm('  hello  ')).toBe('hello');
    expect(normalizeSearchTerm('a,b(c)%')).toBe('a b c');
    expect(normalizeSearchTerm('   ')).toBe('');
  });

  it('searchOrClause is built from normalizeSearchTerm, so "50%" has no live wildcard or doubled %%', () => {
    expect(searchOrClause('50%')).toBe(
      KANBAN_SEARCH_COLUMNS.map((col) => `${col}.ilike.%${normalizeSearchTerm('50%')}%`).join(','),
    );
    expect(searchOrClause('50%')).toContain('title.ilike.%50%');
    expect(searchOrClause('50%')).not.toContain('%%');
  });

  it('uses a 50-lead page size', () => {
    expect(KANBAN_PAGE_SIZE).toBe(50);
  });
});

describe('pickNextId', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns the following item when current is in the middle', () => {
    expect(pickNextId(list, 'b')).toBe('c');
  });

  it('wraps to the first other item when current is last', () => {
    expect(pickNextId(list, 'c')).toBe('a');
  });

  it('returns the first item when current is not in the list', () => {
    expect(pickNextId(list, 'x')).toBe('a');
  });

  it('returns null when the list holds only the current item', () => {
    expect(pickNextId([{ id: 'a' }], 'a')).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickNextId([], 'a')).toBeNull();
  });
});
