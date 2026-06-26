import { describe, it, expect } from 'vitest';
import { groupIdForServiceType, buildTaskCountMaps } from './serviceTaskMatch';

const groups = [
  { id: 'g-web', code: 'web_seo' },
  { id: 'g-local', code: 'local_seo' },
];

describe('groupIdForServiceType', () => {
  it('returns the group id whose code matches the service', () => {
    expect(groupIdForServiceType(groups, 'web_seo')).toBe('g-web');
    expect(groupIdForServiceType(groups, 'local_seo')).toBe('g-local');
  });
  it('returns null when no group matches (ai_seo / hosting / ads)', () => {
    expect(groupIdForServiceType(groups, 'hosting')).toBeNull();
  });
});

describe('buildTaskCountMaps', () => {
  it('counts deal-scoped dept-matched tasks into byDeal', () => {
    const rows = [
      { deal_id: 'd1', job_id: null, department_group_id: 'g-web' },
      { deal_id: 'd1', job_id: null, department_group_id: 'g-web' },
      { deal_id: 'd2', job_id: null, department_group_id: 'g-web' },
    ];
    const { byDeal, byJob } = buildTaskCountMaps(rows, 'g-web');
    expect(byDeal).toEqual({ d1: 2, d2: 1 });
    expect(byJob).toEqual({});
  });
  it('ignores deal tasks whose department is a different service', () => {
    const rows = [{ deal_id: 'd1', job_id: null, department_group_id: 'g-local' }];
    expect(buildTaskCountMaps(rows, 'g-web').byDeal).toEqual({});
  });
  it('counts job-scoped tasks into byJob regardless of department', () => {
    const rows = [
      { deal_id: null, job_id: 'j1', department_group_id: 'g-local' },
      { deal_id: null, job_id: 'j1', department_group_id: 'g-web' },
    ];
    expect(buildTaskCountMaps(rows, 'g-web').byJob).toEqual({ j1: 2 });
  });
  it('with a null serviceGroupId, only job-scoped tasks count', () => {
    const rows = [
      { deal_id: 'd1', job_id: null, department_group_id: 'g-web' },
      { deal_id: null, job_id: 'j1', department_group_id: 'g-web' },
    ];
    const { byDeal, byJob } = buildTaskCountMaps(rows, null);
    expect(byDeal).toEqual({});
    expect(byJob).toEqual({ j1: 1 });
  });
});
