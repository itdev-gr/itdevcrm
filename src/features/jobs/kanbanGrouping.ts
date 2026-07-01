import type { JobRow } from './hooks/useJobs';

type StageLite = { id: string; board: string; code: string };

/**
 * Boards that render a virtual "Blocked" column: blocked jobs are shown there
 * instead of their stage column. stage_id is untouched, so unblocking returns
 * the card to exactly where it was. Every board whose jobs can be auto-held when
 * the deal goes On-Hold carries the column — i.e. all services except the website
 * (web_dev) and hosting, which are never blocked.
 */
export const BLOCKED_COLUMN_BOARDS = new Set([
  'local_seo',
  'web_seo',
  'social_media',
  'ads',
]);

export function hasBlockedColumn(board: string): boolean {
  return BLOCKED_COLUMN_BOARDS.has(board);
}

export type SortBy = 'newest' | 'oldest' | 'recent' | 'stale';

/**
 * Comparator for kanban cards. All modes tie-break by id desc so identical
 * timestamps produce a deterministic order (no jitter on refetch).
 *  - newest / oldest: by created_at
 *  - recent / stale:  by updated_at
 */
export function compareJobs(sortBy: SortBy): (a: JobRow, b: JobRow) => number {
  const key: 'created_at' | 'updated_at' =
    sortBy === 'recent' || sortBy === 'stale' ? 'updated_at' : 'created_at';
  const ascending = sortBy === 'oldest' || sortBy === 'stale';
  return (a, b) => {
    const va = (a[key] as string | null) ?? '';
    const vb = (b[key] as string | null) ?? '';
    if (va !== vb) {
      if (ascending) return va < vb ? -1 : 1;
      return va < vb ? 1 : -1;
    }
    // Always id desc for a stable tie-break, in every mode.
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;
    return 0;
  };
}

/**
 * Stable, fixed card order: newest-created on top, with id as a deterministic
 * tie-breaker. Independent of updated_at, so opening or editing a job never
 * moves its card — and identical timestamps no longer jitter on refetch.
 */
function compareJobsStable(a: JobRow, b: JobRow): number {
  const ca = a.created_at ?? '';
  const cb = b.created_at ?? '';
  if (ca !== cb) return ca < cb ? 1 : -1; // created_at desc (newest first)
  if (a.id !== b.id) return a.id < b.id ? 1 : -1; // id desc tie-breaker
  return 0;
}

export function groupJobsForBoard(args: {
  board: string;
  jobs: JobRow[];
  boardStages: StageLite[];
  stageById: Map<string, StageLite>;
}): { byColumn: Map<string, JobRow[]>; blocked: JobRow[] } {
  const colByCode = new Map(args.boardStages.map((s) => [s.code, s]));
  const byColumn = new Map<string, JobRow[]>(args.boardStages.map((s) => [s.id, []]));
  const blocked: JobRow[] = [];
  const blockedColumn = hasBlockedColumn(args.board);

  for (const j of args.jobs) {
    if (!j.stage_id) continue;
    const jobStage = args.stageById.get(j.stage_id);
    if (!jobStage) continue;
    if (blockedColumn && j.is_blocked) {
      blocked.push(j);
      continue;
    }
    const code = jobStage.code;
    const col = colByCode.get(code);
    if (!col) continue;
    byColumn.get(col.id)?.push(j);
  }
  for (const arr of byColumn.values()) arr.sort(compareJobsStable);
  blocked.sort(compareJobsStable);
  return { byColumn, blocked };
}
