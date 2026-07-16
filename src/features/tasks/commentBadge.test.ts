import { describe, it, expect } from 'vitest';
import { unreadCommentIndex, splitTaskIdsByKind } from './commentBadge';

const notif = (id: string, task_kind: unknown, task_id: unknown) =>
  ({ id, payload: { task_kind, task_id } });

describe('unreadCommentIndex', () => {
  it('groups by card key with counts and notif ids', () => {
    const idx = unreadCommentIndex([
      notif('n1', 'user_task', 't1'),
      notif('n2', 'user_task', 't1'),
      notif('n3', 'assigned_task', 't2'),
    ]);
    expect(idx.get('user:t1')).toEqual({ count: 2, notifIds: ['n1', 'n2'] });
    expect(idx.get('assigned:t2')).toEqual({ count: 1, notifIds: ['n3'] });
  });

  it('keeps user_task and assigned_task with the same task id separate', () => {
    const idx = unreadCommentIndex([
      notif('n1', 'user_task', 'x'),
      notif('n2', 'assigned_task', 'x'),
    ]);
    expect(idx.get('user:x')?.count).toBe(1);
    expect(idx.get('assigned:x')?.count).toBe(1);
  });

  it('ignores malformed payloads', () => {
    const idx = unreadCommentIndex([
      notif('n1', 'bogus_kind', 't1'),
      notif('n2', 'user_task', 42),
      notif('n3', 'user_task', ''),
      { id: 'n4', payload: {} },
    ]);
    expect(idx.size).toBe(0);
  });
});

describe('splitTaskIdsByKind', () => {
  it('splits mixed keys into per-table id lists', () => {
    expect(splitTaskIdsByKind(['user:a', 'assigned:b', 'user:c'])).toEqual({
      userIds: ['a', 'c'],
      assignedIds: ['b'],
    });
  });

  it('returns empty lists for an empty input', () => {
    expect(splitTaskIdsByKind([])).toEqual({ userIds: [], assignedIds: [] });
  });

  it('ignores malformed or unknown-kind keys', () => {
    expect(
      splitTaskIdsByKind(['nope', ':x', 'user:', 'other:z', 'assigned:', 'user:d']),
    ).toEqual({ userIds: ['d'], assignedIds: [] });
  });
});
