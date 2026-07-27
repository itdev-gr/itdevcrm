import { describe, it, expect } from 'vitest';
import { chunkIds, foreignCommentKeys, replyCandidateIds } from './repliesIndex';
import type { TaskCard } from './taskCard';

const card = (o: Partial<TaskCard>): TaskCard => ({
  key: 'assigned:a1', kind: 'assigned', id: 'a1', title: 't', importance: 'low',
  relation: 'mine', resolved: false, assigneeId: 'me', creatorId: 'boss',
  createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
  sourceCode: null, link: null, notes: null, clientName: null, clientId: null, leadName: null,
  creatorResolvedAt: null, assigneeResolvedAt: null, summary: null, ...o,
});

describe('chunkIds', () => {
  it('splits into chunks of the given size, no empty chunks', () => {
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(chunkIds([], 2)).toEqual([]);
  });
  it('defaults to chunks of 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

describe('foreignCommentKeys', () => {
  it('maps id columns to card keys and dedupes', () => {
    const keys = foreignCommentKeys([
      { user_task_id: 'u1', assigned_task_id: null },
      { user_task_id: null, assigned_task_id: 'a1' },
      { user_task_id: null, assigned_task_id: 'a1' },
      { user_task_id: null, assigned_task_id: null },
    ]);
    expect(keys).toEqual(new Set(['user:u1', 'assigned:a1']));
  });
});

describe('replyCandidateIds', () => {
  it('keeps open party cards only (mine + delegated), sorted, split by kind', () => {
    const cards = [
      card({ key: 'assigned:a2', id: 'a2', relation: 'mine' }),
      card({ key: 'assigned:a1', id: 'a1', relation: 'delegated' }),
      card({ key: 'user:u1', id: 'u1', kind: 'user', relation: 'mine' }),
      card({ key: 'assigned:a3', id: 'a3', relation: 'other' }),      // excluded
      card({ key: 'assigned:a4', id: 'a4', resolved: true }),          // excluded
    ];
    expect(replyCandidateIds(cards)).toEqual({ userIds: ['u1'], assignedIds: ['a1', 'a2'] });
  });
});
