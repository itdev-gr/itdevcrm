import { describe, it, expect } from 'vitest';
import { closeTargetCode, closeTargetStageId, buildCloseJobs } from './closeTargets';

const stages = [
  { id: 'ws-closed', board: 'web_seo', code: 'closed' },
  { id: 'ls-closed', board: 'local_seo', code: 'closed' },
  { id: 'wd-live', board: 'web_dev', code: 'live' },
  { id: 'wd-closed', board: 'web_dev', code: 'closed' },
  { id: 'sm-closed', board: 'social_media', code: 'closed' },
] as const;

describe('closeTargetCode', () => {
  it('every service board → its Closed lane; web_dev honours the per-job choice', () => {
    expect(closeTargetCode('web_seo')).toBe('closed');
    expect(closeTargetCode('local_seo')).toBe('closed');
    expect(closeTargetCode('social_media')).toBe('closed');
    expect(closeTargetCode('ads')).toBe('closed');
    expect(closeTargetCode('hosting')).toBe('closed');
    expect(closeTargetCode('web_dev')).toBe('closed');
    expect(closeTargetCode('web_dev', 'live')).toBe('live');
  });
});

describe('closeTargetStageId', () => {
  it('resolves id for board + target', () => {
    expect(closeTargetStageId([...stages], 'web_seo')).toBe('ws-closed');
    expect(closeTargetStageId([...stages], 'local_seo')).toBe('ls-closed');
    expect(closeTargetStageId([...stages], 'web_dev', 'live')).toBe('wd-live');
    expect(closeTargetStageId([...stages], 'web_dev', 'closed')).toBe('wd-closed');
  });
  it('null when the board has no matching lane', () => {
    expect(closeTargetStageId([...stages], 'ads')).toBeNull();
  });
});

describe('buildCloseJobs', () => {
  const jobs = [
    { id: 'j1', stage: { board: 'web_seo' } },
    { id: 'j2', stage: { board: 'web_dev' } },
    { id: 'j3', stage: { board: 'social_media' } },
  ];
  it('only includes checked jobs and honours web_dev choice', () => {
    const out = buildCloseJobs(
      jobs,
      { j1: true, j2: true, j3: false },
      { j2: 'live' },
      [...stages],
    );
    expect(out).toEqual([
      { job_id: 'j1', target_stage_id: 'ws-closed' },
      { job_id: 'j2', target_stage_id: 'wd-live' },
    ]);
  });
  it('drops jobs whose board has no resolvable lane', () => {
    const out = buildCloseJobs(
      [{ id: 'jx', stage: { board: 'ads' } }],
      { jx: true },
      {},
      [...stages],
    );
    expect(out).toEqual([]);
  });
});
