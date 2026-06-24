import { describe, it, expect } from 'vitest';
import { groupJobsForBoard, hasBlockedColumn } from './kanbanGrouping';
import type { JobRow } from './hooks/useJobs';

type StageLite = { id: string; board: string; code: string; archived: boolean; position: number };

const localStages: StageLite[] = [
  { id: 'ls-new', board: 'local_seo', code: 'new_project', archived: false, position: 10 },
  { id: 'ls-opt', board: 'local_seo', code: 'optimize', archived: false, position: 50 },
  { id: 'ls-done', board: 'local_seo', code: 'done', archived: false, position: 80 },
];
const webSeoStages: StageLite[] = [
  { id: 'ws-new', board: 'web_seo', code: 'new_project', archived: false, position: 10 },
  { id: 'ws-content', board: 'web_seo', code: 'content', archived: false, position: 100 },
];
const webDevStages: StageLite[] = [
  { id: 'wd-brief', board: 'web_dev', code: 'awaiting_brief', archived: false, position: 10 },
];
const stageById = new Map<string, StageLite>(
  [...localStages, ...webSeoStages, ...webDevStages].map((s) => [s.id, s]),
);

function job(partial: Partial<JobRow>): JobRow {
  return { id: 'j', service_type: 'local_seo', stage_id: 'ls-new', is_blocked: false, ...partial } as JobRow;
}

describe('groupJobsForBoard', () => {
  it('puts blocked local_seo jobs into the blocked bucket, not their stage column', () => {
    const jobs = [
      job({ id: 'a', stage_id: 'ls-opt' }),
      job({ id: 'b', stage_id: 'ls-opt', is_blocked: true }),
    ];
    const { byColumn, blocked } = groupJobsForBoard({
      board: 'local_seo', jobs, boardStages: localStages, stageById,
    });
    expect(byColumn.get('ls-opt')?.map((j) => j.id)).toEqual(['a']);
    expect(blocked.map((j) => j.id)).toEqual(['b']);
  });

  it('puts blocked web_seo jobs into the blocked bucket (web_seo has a Blocked column)', () => {
    const jobs = [
      job({ id: 'a', service_type: 'web_seo', stage_id: 'ws-content' }),
      job({ id: 'b', service_type: 'web_seo', stage_id: 'ws-content', is_blocked: true }),
    ];
    const { byColumn, blocked } = groupJobsForBoard({
      board: 'web_seo', jobs, boardStages: webSeoStages, stageById,
    });
    expect(byColumn.get('ws-content')?.map((j) => j.id)).toEqual(['a']);
    expect(blocked.map((j) => j.id)).toEqual(['b']);
  });

  it('keeps blocked jobs in their stage column on boards without a Blocked column', () => {
    const jobs = [job({ id: 'a', service_type: 'web_dev', stage_id: 'wd-brief', is_blocked: true })];
    const { byColumn, blocked } = groupJobsForBoard({
      board: 'web_dev', jobs, boardStages: webDevStages, stageById,
    });
    expect(byColumn.get('wd-brief')?.map((j) => j.id)).toEqual(['a']);
    expect(blocked).toEqual([]);
  });
});

describe('hasBlockedColumn', () => {
  it('is on for local_seo and web_seo (the SEO boards), off elsewhere', () => {
    expect(hasBlockedColumn('local_seo')).toBe(true);
    expect(hasBlockedColumn('web_seo')).toBe(true);
    expect(hasBlockedColumn('web_dev')).toBe(false);
  });
});
