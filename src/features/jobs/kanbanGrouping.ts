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
  return { byColumn, blocked };
}
