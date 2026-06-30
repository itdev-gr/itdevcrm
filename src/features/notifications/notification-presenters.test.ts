import { describe, it, expect } from 'vitest';
import { readPath } from './notification-presenters';

describe('readPath — parent fallback', () => {
  it('maps a deal parent to /deals/:id', () => {
    expect(readPath({ parent_type: 'deal', parent_id: 'd1' })).toBe('/deals/d1');
  });
  it('maps a job parent to /jobs/:id', () => {
    expect(readPath({ parent_type: 'job', parent_id: 'j1' })).toBe('/jobs/j1');
  });
  it('maps a lead parent to /leads/:id', () => {
    expect(readPath({ parent_type: 'lead', parent_id: 'l1' })).toBe('/leads/l1');
  });
  it('maps a client parent to /clients/:id', () => {
    expect(readPath({ parent_type: 'client', parent_id: 'c1' })).toBe('/clients/c1');
  });
  it('falls back to the tasks board when the user_task parent has no task_id', () => {
    expect(readPath({ parent_type: 'user_task', parent_id: 'u1' })).toBe('/tasks?open=user:u1');
  });
  it('returns null for a non-string parent id', () => {
    expect(readPath({ parent_type: 'deal', parent_id: null })).toBeNull();
  });
  it('returns null for an unknown parent type', () => {
    expect(readPath({ parent_type: 'mystery', parent_id: 'x' })).toBeNull();
  });
  it('returns null for null / empty payloads', () => {
    expect(readPath(null)).toBeNull();
    expect(readPath({})).toBeNull();
  });
});

describe('readPath — task routing', () => {
  it('routes an assigned-task notification to /tasks?open=assigned:<id> (not the deal)', () => {
    // task_assigned payload from assigned_tasks_notify_assignee: parent points
    // at the deal, but the click should land the user on their TASK.
    expect(
      readPath({ task_id: 't1', parent_type: 'deal', parent_id: 'd1' }),
    ).toBe('/tasks?open=assigned:t1');
  });
  it('routes an assigned-task on a job to /tasks?open=assigned:<id>', () => {
    expect(
      readPath({ task_id: 't2', parent_type: 'job', parent_id: 'j2' }),
    ).toBe('/tasks?open=assigned:t2');
  });
  it('routes a user_task notification to /tasks?open=user:<id>', () => {
    expect(
      readPath({ task_id: 't3', parent_type: 'user_task', parent_id: 't3' }),
    ).toBe('/tasks?open=user:t3');
  });
  it('uses task_kind to disambiguate when parent_type is non-task (user_task comment)', () => {
    expect(
      readPath({ task_id: 't4', task_kind: 'user_task' }),
    ).toBe('/tasks?open=user:t4');
  });
  it('uses task_kind to disambiguate when parent_type is non-task (assigned_task comment)', () => {
    expect(
      readPath({ task_id: 't5', task_kind: 'assigned_task', parent_type: 'deal', parent_id: 'd5' }),
    ).toBe('/tasks?open=assigned:t5');
  });
  it('ignores a non-string task_id and falls back to the parent', () => {
    expect(
      readPath({ task_id: null, parent_type: 'deal', parent_id: 'd6' }),
    ).toBe('/deals/d6');
  });
});
