import { describe, it, expect } from 'vitest';
import {
  relationOf, userTaskToCard, assignedTaskToCard, columnOf, isDraggable,
  buildBoardCards, matchesFilter, resolveDrag, BOARD_COLUMNS, type TaskCard,
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

  it('isDraggable only for my own cards', () => {
    expect(isDraggable(assignedTaskToCard(assignedRow(), me))).toBe(true);
    expect(isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x' }), me))).toBe(false);
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

  it('exposes the five columns urgent→resolved', () => {
    expect(BOARD_COLUMNS).toEqual(['urgent', 'high', 'medium', 'low', 'resolved']);
  });

  describe('resolveDrag', () => {
    const mine = (o = {}) => assignedTaskToCard(assignedRow(o), me) as TaskCard;
    it('noop for non-draggable cards', () => {
      expect(resolveDrag(mine({ assignee_user_id: 'x' }), 'urgent')).toEqual({ type: 'noop' });
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
