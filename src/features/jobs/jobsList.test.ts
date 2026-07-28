// src/features/jobs/jobsList.test.ts
import { describe, it, expect } from 'vitest';
import { filterAndSortJobsList, jobListDomain, jobListStatus } from './jobsList';
import type { JobRow } from '@/features/jobs/hooks/useJobs';

const mk = (o: Partial<JobRow>): JobRow =>
  ({
    id: 'j', code: '000001-SUPPORT', service_type: 'maintenance', period_due_date: null,
    is_blocked: false,
    stage: { id: 's', code: 'active', board: 'maintenance', display_names: {} },
    client: { id: 'c', name: 'Acme', contact_first_name: null, contact_last_name: null, industry: null },
    details: {}, parent_job_id: null,
    ...o,
  }) as unknown as JobRow;

const stage = (code: string) => ({ id: 's', code, board: 'maintenance', display_names: {} });
const OPTS = { doneStageCodes: new Set(['done', 'closed']), blockedAware: true };

describe('jobListStatus', () => {
  it('derives status from the stage code (done + closed both read as Done)', () => {
    expect(jobListStatus(mk({ stage: stage('active') }), OPTS)).toBe('active');
    expect(jobListStatus(mk({ stage: stage('onboarding') }), OPTS)).toBe('active');
    expect(jobListStatus(mk({ stage: stage('done') }), OPTS)).toBe('done');
    expect(jobListStatus(mk({ stage: stage('closed') }), OPTS)).toBe('done');
  });

  it('hosting parity: single done code, blocked flag ignored when not blockedAware', () => {
    const hostingOpts = { doneStageCodes: new Set(['closed']), blockedAware: false };
    expect(jobListStatus(mk({ stage: stage('closed'), is_blocked: true }), hostingOpts)).toBe('done');
    expect(jobListStatus(mk({ stage: stage('active'), is_blocked: true }), hostingOpts)).toBe('active');
  });

  it('blocked wins over any stage when blockedAware', () => {
    expect(jobListStatus(mk({ is_blocked: true, stage: stage('active') }), OPTS)).toBe('blocked');
    expect(jobListStatus(mk({ is_blocked: true, stage: stage('closed') }), OPTS)).toBe('blocked');
  });

  it('derives status from stage_id when doneStageIds is given (optimistic move)', () => {
    // stage.code is stale ('active') but stage_id says done — stage_id must win.
    const j = mk({ stage_id: 'done-id', stage: stage('active') });
    expect(jobListStatus(j, { ...OPTS, doneStageIds: new Set(['done-id']) })).toBe('done');
    expect(jobListStatus(j, { ...OPTS, doneStageIds: new Set(['other-id']) })).toBe('active');
  });
});

describe('jobListDomain', () => {
  it('picks the domain from details then client website', () => {
    expect(jobListDomain(mk({ details: { live_url: 'a.gr' } }))).toBe('a.gr');
    expect(jobListDomain(mk({ details: { hosting: 'b.gr' } }))).toBe('b.gr');
    expect(jobListDomain(mk({ details: {}, client: { id: 'c', name: 'X', website: 'c.gr' } as NonNullable<JobRow['client']> }))).toBe('c.gr');
    expect(jobListDomain(mk({ details: {} }))).toBe('');
  });
});

describe('filterAndSortJobsList', () => {
  const jobs = [
    mk({ id: 'a', client: { id: '1', name: 'Beta' } as NonNullable<JobRow['client']>, period_due_date: '2026-09-01' }),
    mk({ id: 'b', client: { id: '2', name: 'Alpha' } as NonNullable<JobRow['client']>, period_due_date: '2026-08-01' }),
    mk({ id: 'c', client: { id: '3', name: 'Gamma' } as NonNullable<JobRow['client']>, period_due_date: null }),
    mk({ id: 'd', client: { id: '4', name: 'Done Co' } as NonNullable<JobRow['client']>,
        stage: stage('closed'), period_due_date: '2026-01-01' }),
    mk({ id: 'e', client: { id: '5', name: 'Frozen' } as NonNullable<JobRow['client']>,
        is_blocked: true, period_due_date: '2026-07-01' }),
  ];

  it('Active pill keeps blocked rows, excludes done; sorts by due asc nulls last', () => {
    const active = filterAndSortJobsList(jobs, { status: 'active', search: '' }, OPTS);
    expect(active.map((j) => j.id)).toEqual(['e', 'b', 'a', 'c']);
  });

  it('Done pill shows only done; All shows everything', () => {
    expect(filterAndSortJobsList(jobs, { status: 'done', search: '' }, OPTS).map((j) => j.id)).toEqual(['d']);
    expect(filterAndSortJobsList(jobs, { status: 'all', search: '' }, OPTS).map((j) => j.id)).toEqual(['d', 'e', 'b', 'a', 'c']);
  });

  it('searches client name, code and domain', () => {
    expect(filterAndSortJobsList(jobs, { status: 'all', search: 'alpha' }, OPTS).map((j) => j.id)).toEqual(['b']);
    expect(filterAndSortJobsList(jobs, { status: 'all', search: 'no-match-xyz' }, OPTS)).toEqual([]);
  });
});
