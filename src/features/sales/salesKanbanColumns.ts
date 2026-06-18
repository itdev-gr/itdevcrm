export const KANBAN_PAGE_SIZE = 50;

export type SortBy = 'newest' | 'oldest' | 'value_high' | 'value_low' | 'recent';

// Lead row + its stage — the shape both kanban queries select.
export const LEAD_SELECT = '*, stage:pipeline_stages(id, code, board, display_names)';

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

// PostgREST `or=` clause for the kanban search box; null when the term is empty.
// Strips characters that would break the filter grammar (`%` `,` `(` `)`).
export function searchOrClause(search: string): string | null {
  const v = search.replace(/[%,()]/g, ' ').trim();
  if (!v) return null;
  const like = `%${v}%`;
  return [
    `title.ilike.${like}`,
    `company_name.ilike.${like}`,
    `contact_first_name.ilike.${like}`,
    `contact_last_name.ilike.${like}`,
    `email.ilike.${like}`,
    `phone.ilike.${like}`,
  ].join(',');
}
