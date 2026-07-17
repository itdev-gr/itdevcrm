import { describe, it, expect } from 'vitest';
import {
  relationOf, userTaskToCard, assignedTaskToCard, columnOf, isDraggable,
  buildBoardCards, matchesFilter, resolveDrag, viewerSideStamped, BOARD_COLUMNS, type TaskCard,
} from './taskCard';

const me = 'me';
const userRow = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'u1', title: 'P', user_id: me, created_by: me, completed_at: null,
  due_at: '2026-07-01T10:00:00Z', importance: 'low', ...o,
}) as never;
const assignedRow = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1', title: 'A', assignee_user_id: me, created_by_user_id: me, status: 'open',
  resolved_at: null, importance: 'high', source_code: 'D-1', deal_id: 'd1', job_id: null, ...o,
}) as never;

describe('taskCard', () => {
  it('classifies relation: mine / delegated / other', () => {
    expect(relationOf(me, 'x', me)).toBe('mine');
    expect(relationOf('x', me, me)).toBe('delegated');
    expect(relationOf('x', 'y', me)).toBe('other');
  });

  it('maps a user task to a card', () => {
    const c = userTaskToCard(userRow({ user_id: 'x' }), me);
    expect(c).toMatchObject({ kind: 'user', id: 'u1', importance: 'low', relation: 'delegated', resolved: false, link: null, sourceCode: null, key: 'user:u1' });
  });

  it('maps a lead-linked user task to a lead code chip + link', () => {
    const c = userTaskToCard(
      userRow({ lead: { id: 'L1', title: 'Bakery Lead', code: '001234' } }),
      me,
    );
    expect(c.sourceCode).toBe('001234');
    expect(c.link).toBe('/leads/L1');
    expect(c.leadName).toBe('Bakery Lead');
  });

  it('user task without a lead keeps the personal chip (no link)', () => {
    const c = userTaskToCard(userRow(), me);
    expect(c.sourceCode).toBeNull();
    expect(c.link).toBeNull();
    expect(c.leadName).toBeNull();
  });

  it('maps an assigned task to a card with a deal link', () => {
    const c = assignedTaskToCard(assignedRow(), me);
    expect(c).toMatchObject({ kind: 'assigned', relation: 'mine', link: '/deals/d1', sourceCode: 'D-1', key: 'assigned:a1' });
  });

  it('maps an assigned job task link', () => {
    const c = assignedTaskToCard(assignedRow({ deal_id: null, job_id: 'j1' }), me);
    expect(c.link).toBe('/jobs/j1');
  });

  it('columnOf returns importance when open, resolved when done', () => {
    expect(columnOf(userTaskToCard(userRow(), me))).toBe('low');
    expect(columnOf(userTaskToCard(userRow({ completed_at: '2026-07-02T00:00:00Z' }), me))).toBe('resolved');
    expect(columnOf(assignedTaskToCard(assignedRow({ status: 'resolved' }), me))).toBe('resolved');
  });

  it('isDraggable for the assignee (mine) and creator (delegated), not others', () => {
    expect(isDraggable(assignedTaskToCard(assignedRow(), me))).toBe(true); // mine
    // creator (created_by defaults to me) can drag-to-stamp their side too
    expect(isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x' }), me))).toBe(true);
    // a task where I'm neither party stays non-draggable
    expect(
      isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: 'y' }), me)),
    ).toBe(false);
  });

  it('matchesFilter: to_me / by_me / all', () => {
    const mine = assignedTaskToCard(assignedRow(), me);
    const delegated = assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: me }), me);
    const other = assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: 'y' }), me);
    expect(matchesFilter(mine, 'to_me')).toBe(true);
    expect(matchesFilter(delegated, 'to_me')).toBe(false);
    expect(matchesFilter(delegated, 'by_me')).toBe(true);
    expect(matchesFilter(other, 'all')).toBe(true);
    expect(matchesFilter(other, 'to_me')).toBe(false);
  });

  it('buildBoardCards unions both tables', () => {
    const cards = buildBoardCards([userRow()], [assignedRow()], me);
    expect(cards.map((c) => c.key).sort()).toEqual(['assigned:a1', 'user:u1']);
  });

  it('exposes the six columns replies→resolved', () => {
    expect(BOARD_COLUMNS).toEqual(['replies', 'urgent', 'high', 'medium', 'low', 'resolved']);
  });

  describe('resolveDrag', () => {
    const mine = (o = {}) => assignedTaskToCard(assignedRow(o), me) as TaskCard;
    it('noop for non-draggable cards', () => {
      // neither party (assignee x, creator y) → not draggable
      expect(resolveDrag(mine({ assignee_user_id: 'x', created_by_user_id: 'y' }), 'urgent')).toEqual({ type: 'noop' });
    });
    it('open card dropped on Resolved → resolve', () => {
      expect(resolveDrag(mine(), 'resolved')).toEqual({ type: 'resolve' });
    });
    it('open card dropped on a different urgency → set-importance', () => {
      expect(resolveDrag(mine({ importance: 'high' }), 'urgent')).toEqual({ type: 'set-importance', importance: 'urgent' });
    });
    it('open card dropped on its own column → noop', () => {
      expect(resolveDrag(mine({ importance: 'high' }), 'high')).toEqual({ type: 'noop' });
    });
    it('resolved card dropped on an urgency → reopen at that urgency', () => {
      expect(resolveDrag(mine({ status: 'resolved', importance: 'low' }), 'high')).toEqual({ type: 'reopen', importance: 'high' });
    });
    it('resolved card dropped on Resolved → noop', () => {
      expect(resolveDrag(mine({ status: 'resolved' }), 'resolved')).toEqual({ type: 'noop' });
    });
  });
});

describe('replies column', () => {
  it('a reply wins over importance on open tasks', () => {
    const c = userTaskToCard(userRow(), me);
    expect(columnOf(c, true)).toBe('replies');
    expect(columnOf(c, false)).toBe(columnOf(c)); // legacy default unchanged
  });

  it('resolved wins over replies — a closed task never renders in Replies', () => {
    const c = assignedTaskToCard(assignedRow({ status: 'resolved' }), me);
    expect(columnOf(c)).toBe('resolved');
    expect(columnOf(c, true)).toBe('resolved');
  });

  it('cards in Replies stay draggable for both parties', () => {
    expect(isDraggable(assignedTaskToCard(assignedRow(), me))).toBe(true); // mine
    expect(isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x' }), me))).toBe(true); // delegated
    expect(
      isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: 'y' }), me)),
    ).toBe(false); // other
  });

  it('dropping onto the replies column is a noop', () => {
    const c = userTaskToCard(userRow(), me);
    expect(resolveDrag(c, 'replies')).toEqual({ type: 'noop' });
  });

  it('replies is the first board column', () => {
    expect(BOARD_COLUMNS[0]).toBe('replies');
    expect(BOARD_COLUMNS).toHaveLength(6);
  });
});

const vCard = (over: Partial<TaskCard>): TaskCard => ({
  key: 'assigned:t1', kind: 'assigned', id: 't1', title: 'T', importance: 'medium',
  relation: 'mine', resolved: false, assigneeId: 'A', creatorId: 'C',
  createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
  sourceCode: null, link: null, notes: null, clientName: null, leadName: null,
  creatorResolvedAt: null, assigneeResolvedAt: null, summary: null,
  ...over,
});

describe('viewerSideStamped', () => {
  it('assignee viewer with assignee stamp → true', () => {
    expect(viewerSideStamped(vCard({ relation: 'mine', assigneeResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(true);
  });
  it('assignee viewer with only the creator stamp → false', () => {
    expect(viewerSideStamped(vCard({ relation: 'mine', creatorResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(false);
  });
  it('creator viewer with creator stamp → true', () => {
    expect(viewerSideStamped(vCard({ relation: 'delegated', creatorResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(true);
  });
  it('non-party viewer → false', () => {
    expect(viewerSideStamped(vCard({ relation: 'other', creatorResolvedAt: '2026-07-01T00:00:00Z', assigneeResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(false);
  });
});

describe('columnOf — viewer-relative resolved', () => {
  const stamped = vCard({ relation: 'mine', assigneeResolvedAt: '2026-07-01T00:00:00Z', importance: 'high' });
  it('open card with MY side stamped → resolved column', () => {
    expect(columnOf(stamped)).toBe('resolved');
  });
  it('unread replies still win over my stamp', () => {
    expect(columnOf(stamped, true)).toBe('replies');
  });
  it('open card with only the OTHER side stamped → stays on importance', () => {
    expect(columnOf(vCard({ relation: 'mine', creatorResolvedAt: '2026-07-01T00:00:00Z', importance: 'high' }))).toBe('high');
  });
});

describe('resolveDrag — withdraw', () => {
  const stamped = vCard({ relation: 'mine', assigneeResolvedAt: '2026-07-01T00:00:00Z', importance: 'medium' });
  it('viewer-stamped open card dropped on an importance column → withdraw with that importance', () => {
    expect(resolveDrag(stamped, 'high')).toEqual({ type: 'withdraw', importance: 'high' });
  });
  it('viewer-stamped open card dropped on resolved → noop (already there for me)', () => {
    expect(resolveDrag(stamped, 'resolved')).toEqual({ type: 'noop' });
  });
  it('terminal card dropped on an importance column still reopens', () => {
    expect(resolveDrag(vCard({ resolved: true, importance: 'medium' }), 'high')).toEqual({ type: 'reopen', importance: 'high' });
  });
});
