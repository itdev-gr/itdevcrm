import { describe, it, expect } from 'vitest';
import {
  mapClientUserTasks,
  partitionClientTasks,
  filterUserTasksForSource,
} from './useClientUserTasks';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';

const base = {
  id: 't1',
  user_id: 'u1',
  title: 'Call client',
  notes: null,
  due_at: '2026-07-20T10:00:00Z',
  completed_at: null,
  created_at: '2026-07-15T09:00:00Z',
  updated_at: '2026-07-15T09:00:00Z',
  created_by: 'u1',
  importance: 'high',
  client_id: 'c1',
  deal_id: null,
  job_id: null,
  lead_id: null,
  started_at: null,
} as UserTaskRow;

describe('mapClientUserTasks', () => {
  it('maps rows to user TaskCards', () => {
    const card = mapClientUserTasks([base], 'u1')[0]!;
    expect(card.kind).toBe('user');
    expect(card.id).toBe('t1');
    expect(card.title).toBe('Call client');
    expect(card.importance).toBe('high');
    expect(card.resolved).toBe(false);
    expect(card.relation).toBe('mine');
  });

  it('marks completed tasks resolved', () => {
    const card = mapClientUserTasks(
      [{ ...base, completed_at: '2026-07-16T00:00:00Z' } as UserTaskRow],
      'u1',
    )[0]!;
    expect(card.resolved).toBe(true);
  });
});

describe('partitionClientTasks', () => {
  it('splits open and resolved', () => {
    const cards = mapClientUserTasks(
      [base, { ...base, id: 't2', completed_at: '2026-07-16T00:00:00Z' } as UserTaskRow],
      'u1',
    );
    const { open, resolved } = partitionClientTasks(cards);
    expect(open.map((c) => c.id)).toEqual(['t1']);
    expect(resolved.map((c) => c.id)).toEqual(['t2']);
  });
});

describe('filterUserTasksForSource', () => {
  const clientLevel = { ...base, id: 'client' } as UserTaskRow;
  const dealTargeted = { ...base, id: 'deal-d1', deal_id: 'd1', job_id: null } as UserTaskRow;
  const jobTargeted = { ...base, id: 'job-j1', deal_id: 'd1', job_id: 'j1' } as UserTaskRow;
  const rows = [clientLevel, dealTargeted, jobTargeted];

  it('client-level task shows on any deal and any job', () => {
    expect(filterUserTasksForSource([clientLevel], { kind: 'deal', id: 'd2' })).toHaveLength(1);
    expect(filterUserTasksForSource([clientLevel], { kind: 'job', id: 'j9' })).toHaveLength(1);
  });

  it('deal tab shows client-level + this deal (incl. its job-targeted), not other deals', () => {
    const d1 = filterUserTasksForSource(rows, { kind: 'deal', id: 'd1' }).map((r) => r.id);
    expect(d1).toEqual(['client', 'deal-d1', 'job-j1']);
    const d2 = filterUserTasksForSource(rows, { kind: 'deal', id: 'd2' }).map((r) => r.id);
    expect(d2).toEqual(['client']);
  });

  it('job tab shows client-level + this job only', () => {
    const j1 = filterUserTasksForSource(rows, { kind: 'job', id: 'j1' }).map((r) => r.id);
    expect(j1).toEqual(['client', 'job-j1']);
    const j2 = filterUserTasksForSource(rows, { kind: 'job', id: 'j2' }).map((r) => r.id);
    expect(j2).toEqual(['client']);
  });
});
