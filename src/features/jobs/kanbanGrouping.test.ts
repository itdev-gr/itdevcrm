import { describe, it, expect } from 'vitest';
import { groupJobsForBoard, hasBlockedColumn, compareJobs, type SortBy } from './kanbanGrouping';
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

  // The reported bug: opening a job then returning to the board reshuffled the
  // cards. A stable, fixed order (newest-created on top) keeps each card put.
  it('orders each column by created_at desc, regardless of input order', () => {
    const jobs = [
      job({ id: 'b', stage_id: 'ls-opt', created_at: '2026-06-10T00:00:00Z' }),
      job({ id: 'a', stage_id: 'ls-opt', created_at: '2026-06-20T00:00:00Z' }),
      job({ id: 'c', stage_id: 'ls-opt', created_at: '2026-06-15T00:00:00Z' }),
    ];
    const { byColumn } = groupJobsForBoard({
      board: 'local_seo', jobs, boardStages: localStages, stageById,
    });
    expect(byColumn.get('ls-opt')?.map((j) => j.id)).toEqual(['a', 'c', 'b']);
  });

  it('breaks created_at ties by id desc so the order never jitters on refetch', () => {
    const ts = '2026-06-20T00:00:00Z';
    const jobs = [
      job({ id: 'a', stage_id: 'ls-opt', created_at: ts }),
      job({ id: 'c', stage_id: 'ls-opt', created_at: ts }),
      job({ id: 'b', stage_id: 'ls-opt', created_at: ts }),
    ];
    const { byColumn } = groupJobsForBoard({
      board: 'local_seo', jobs, boardStages: localStages, stageById,
    });
    expect(byColumn.get('ls-opt')?.map((j) => j.id)).toEqual(['c', 'b', 'a']);
  });

  it('orders the blocked bucket deterministically too', () => {
    const jobs = [
      job({ id: 'b', stage_id: 'ls-opt', is_blocked: true, created_at: '2026-06-10T00:00:00Z' }),
      job({ id: 'a', stage_id: 'ls-opt', is_blocked: true, created_at: '2026-06-20T00:00:00Z' }),
    ];
    const { blocked } = groupJobsForBoard({
      board: 'local_seo', jobs, boardStages: localStages, stageById,
    });
    expect(blocked.map((j) => j.id)).toEqual(['a', 'b']);
  });
});

describe('hasBlockedColumn', () => {
  it('is on for every board whose jobs can be auto-held (SEO + social + ads)', () => {
    expect(hasBlockedColumn('local_seo')).toBe(true);
    expect(hasBlockedColumn('web_seo')).toBe(true);
    expect(hasBlockedColumn('social_media')).toBe(true);
    expect(hasBlockedColumn('ads')).toBe(true);
  });

  it('is off for the website and hosting, which are never blocked', () => {
    expect(hasBlockedColumn('web_dev')).toBe(false);
    expect(hasBlockedColumn('hosting')).toBe(false);
  });
});

describe('compareJobs', () => {
  const j = (id: string, created_at: string, updated_at: string): JobRow =>
    ({ id, created_at, updated_at, service_type: 'local_seo', stage_id: 'ls-opt', is_blocked: false } as JobRow);

  const rows = [
    j('a', '2026-06-10T00:00:00Z', '2026-06-25T00:00:00Z'),
    j('b', '2026-06-20T00:00:00Z', '2026-06-11T00:00:00Z'),
    j('c', '2026-06-15T00:00:00Z', '2026-06-18T00:00:00Z'),
  ];

  function sortedIds(sortBy: SortBy): string[] {
    return [...rows].sort(compareJobs(sortBy)).map((r) => r.id);
  }

  it('newest: created_at desc', () => {
    expect(sortedIds('newest')).toEqual(['b', 'c', 'a']);
  });

  it('oldest: created_at asc', () => {
    expect(sortedIds('oldest')).toEqual(['a', 'c', 'b']);
  });

  it('recent: updated_at desc', () => {
    expect(sortedIds('recent')).toEqual(['a', 'c', 'b']);
  });

  it('stale: updated_at asc', () => {
    expect(sortedIds('stale')).toEqual(['b', 'c', 'a']);
  });

  it('newest: breaks created_at ties by id desc so refetches do not jitter', () => {
    const ts = '2026-06-20T00:00:00Z';
    const tied = [
      j('a', ts, ts),
      j('c', ts, ts),
      j('b', ts, ts),
    ];
    expect([...tied].sort(compareJobs('newest')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('recent: breaks updated_at ties by id desc', () => {
    const ts = '2026-06-20T00:00:00Z';
    const tied = [
      j('a', '2026-01-01T00:00:00Z', ts),
      j('c', '2026-01-02T00:00:00Z', ts),
      j('b', '2026-01-03T00:00:00Z', ts),
    ];
    expect([...tied].sort(compareJobs('recent')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});
