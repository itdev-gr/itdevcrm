import { describe, it, expect } from 'vitest';
import {
  KANBAN_COLUMN_LIMIT,
  COLLAPSED_STAGE_CODES,
  isCollapsedStage,
  orderForSort,
  overflowCount,
} from './salesKanbanColumns';

describe('salesKanbanColumns', () => {
  it('marks dead stages as collapsed', () => {
    expect(isCollapsedStage('not_interested')).toBe(true);
    expect(isCollapsedStage('dead_end')).toBe(true);
    expect(isCollapsedStage('new_lead')).toBe(false);
    expect(isCollapsedStage('won')).toBe(false);
  });

  it('maps every sort option to a server order clause', () => {
    expect(orderForSort('newest')).toEqual({ column: 'created_at', ascending: false });
    expect(orderForSort('oldest')).toEqual({ column: 'created_at', ascending: true });
    expect(orderForSort('recent')).toEqual({ column: 'updated_at', ascending: false });
    expect(orderForSort('value_high')).toEqual({ column: 'estimated_total_value', ascending: false });
    expect(orderForSort('value_low')).toEqual({ column: 'estimated_total_value', ascending: true });
  });

  it('computes overflow = total minus shown (never negative)', () => {
    expect(overflowCount(533, 50)).toBe(483);
    expect(overflowCount(10, 50)).toBe(0);
    expect(overflowCount(50, 50)).toBe(0);
  });

  it('exposes a sane cap and the collapsed set', () => {
    expect(KANBAN_COLUMN_LIMIT).toBe(50);
    expect(COLLAPSED_STAGE_CODES).toEqual(['not_interested', 'dead_end']);
  });
});
