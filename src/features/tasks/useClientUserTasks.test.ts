import { describe, it, expect } from 'vitest';
import { mapClientUserTasks, partitionClientTasks } from './useClientUserTasks';
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
