export const KANBAN_COLUMN_LIMIT = 50;

export const COLLAPSED_STAGE_CODES = ['not_interested', 'dead_end'] as const;

export type SortBy = 'newest' | 'oldest' | 'value_high' | 'value_low' | 'recent';

export function isCollapsedStage(code: string): boolean {
  return (COLLAPSED_STAGE_CODES as readonly string[]).includes(code);
}

export function orderForSort(sortBy: SortBy): { column: string; ascending: boolean } {
  switch (sortBy) {
    case 'oldest':
      return { column: 'created_at', ascending: true };
    case 'recent':
      return { column: 'updated_at', ascending: false };
    case 'value_high':
      return { column: 'estimated_total_value', ascending: false };
    case 'value_low':
      return { column: 'estimated_total_value', ascending: true };
    case 'newest':
    default:
      return { column: 'created_at', ascending: false };
  }
}

export function overflowCount(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
