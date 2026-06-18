import { describe, it, expect } from 'vitest';
import { KANBAN_PAGE_SIZE, orderForSort, searchOrClause } from './salesKanbanColumns';

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
  });

  it('strips PostgREST-breaking characters from the search term', () => {
    const c = searchOrClause('a,b(c)%');
    expect(c).toContain('title.ilike.%a b c%');
  });

  it('uses a 50-lead page size', () => {
    expect(KANBAN_PAGE_SIZE).toBe(50);
  });
});
