import type { JobRow } from './hooks/useJobs';

type StageLite = { id: string; board: string; code: string };

/**
 * Boards that render a virtual "Blocked" column: blocked jobs are shown there
 * instead of their stage column. stage_id is untouched, so unblocking returns
 * the card to exactly where it was.
 */
const BLOCKED_COLUMN_BOARDS = new Set(['local_seo']);

export function hasBlockedColumn(board: string): boolean {
  return BLOCKED_COLUMN_BOARDS.has(board);
}

/**
 * AI SEO jobs canonically live on web_seo stages but are also shown on the
 * Local SEO board. The boards no longer share stage codes, so map explicitly.
 */
const AI_SEO_TO_LOCAL_SEO: Record<string, string> = {
  onboarding: 'new_project',
  audit_strategy: 'optimize',
  active: 'optimize',
  on_hold: 'suspended',
  cancelled: 'done',
};

/** Reverse direction for drags; columns without an equivalent return null. */
const LOCAL_SEO_TO_AI_SEO: Record<string, string> = {
  new_project: 'onboarding',
  optimize: 'active',
  suspended: 'on_hold',
  done: 'cancelled',
};

export function aiSeoTargetCode(localSeoColumnCode: string): string | null {
  return LOCAL_SEO_TO_AI_SEO[localSeoColumnCode] ?? null;
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
    const code =
      j.service_type === 'ai_seo' && args.board === 'local_seo'
        ? (AI_SEO_TO_LOCAL_SEO[jobStage.code] ?? '')
        : jobStage.code;
    const col = colByCode.get(code);
    if (!col) continue;
    byColumn.get(col.id)?.push(j);
  }
  return { byColumn, blocked };
}
