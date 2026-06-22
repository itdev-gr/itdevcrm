export type ImportanceCode = 'low' | 'medium' | 'high' | 'urgent';

/** Order the options appear in the create-form select (ascending severity). */
export const IMPORTANCE_OPTIONS: ImportanceCode[] = ['low', 'medium', 'high', 'urgent'];

/** Sort key — urgent first (0), low last (3). */
const RANK: Record<ImportanceCode, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function importanceRank(code: ImportanceCode): number {
  return RANK[code] ?? RANK.low;
}

/** Read a task row's importance, defaulting null/unknown to 'low'. */
export function importanceOf(row: { importance?: string | null }): ImportanceCode {
  const v = row.importance;
  return v === 'urgent' || v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}
