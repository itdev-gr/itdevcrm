/**
 * Drains a PostgREST query completely, immune to the server's 1000-row page
 * cap. Supabase silently truncates any unranged select at max-rows (1000);
 * every list/aggregation the reporting surfaces rely on MUST go through this
 * (see docs/system-analysis/2026-08-27-expenses-reporting-audit.md, E22/E23).
 *
 * `buildQuery` receives (from, to) and must return a FRESH query each call
 * with `.range(from, to)` applied by us — callers only add their filters and
 * ordering. Ordering matters: paging an unordered query can skip/duplicate
 * rows between pages, so we require an explicit `order` column.
 */
export const PAGE_SIZE = 1000;

type RangeableQuery<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }> & {
  range: (from: number, to: number) => RangeableQuery<Row>;
};

export async function fetchAllPages<Row>(
  buildQuery: () => RangeableQuery<Row>,
): Promise<Row[]> {
  const all: Row[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}
