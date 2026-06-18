import type { StageRow } from '@/features/stages/hooks/usePipelineStages';

export type WebDevChoice = 'closed' | 'live';

type StageLite = Pick<StageRow, 'id' | 'board' | 'code'>;

/**
 * The terminal stage CODE a job lands on when its deal closes, given the job's
 * board. web_seo/local_seo → "done"; web_dev → the user's choice (default
 * "closed"); social_media/ads/hosting → "closed".
 */
export function closeTargetCode(board: string, webDevChoice: WebDevChoice = 'closed'): string {
  if (board === 'web_dev') return webDevChoice;
  // web_seo, local_seo, social_media, ads, hosting → their dedicated "Closed" lane.
  return 'closed';
}

/** Resolve the actual target stage id for a job's board, or null if absent. */
export function closeTargetStageId(
  stages: StageLite[],
  board: string,
  webDevChoice: WebDevChoice = 'closed',
): string | null {
  const code = closeTargetCode(board, webDevChoice);
  return stages.find((s) => s.board === board && s.code === code)?.id ?? null;
}

export type CloseJobTarget = { job_id: string; target_stage_id: string };
type JobLike = { id: string; stage?: { board: string } | null };

/**
 * Build the close_deal payload: for each INCLUDED job, resolve its board's close
 * lane (web_dev honours the per-job choice). Jobs with no resolvable target are
 * dropped.
 */
export function buildCloseJobs(
  jobs: JobLike[],
  include: Record<string, boolean>,
  webDev: Record<string, WebDevChoice>,
  stages: StageLite[],
): CloseJobTarget[] {
  return jobs
    .filter((j) => include[j.id])
    .map((j): CloseJobTarget | null => {
      const board = j.stage?.board ?? '';
      const choice = board === 'web_dev' ? (webDev[j.id] ?? 'closed') : 'closed';
      const target = closeTargetStageId(stages, board, choice);
      return target ? { job_id: j.id, target_stage_id: target } : null;
    })
    .filter((x): x is CloseJobTarget => x !== null);
}
