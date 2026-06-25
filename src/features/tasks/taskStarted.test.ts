import { describe, it, expect } from 'vitest';
import { canStartTask, startedBadgeVisible } from './taskStarted';

describe('canStartTask', () => {
  it('true only for the assignee on an open, not-started task', () => {
    expect(canStartTask({ isAssignee: true, resolved: false, startedAt: null })).toBe(true);
  });
  it('false when not the assignee', () => {
    expect(canStartTask({ isAssignee: false, resolved: false, startedAt: null })).toBe(false);
  });
  it('false when already started', () => {
    expect(canStartTask({ isAssignee: true, resolved: false, startedAt: '2026-06-25T00:00:00Z' })).toBe(false);
  });
  it('false when resolved', () => {
    expect(canStartTask({ isAssignee: true, resolved: true, startedAt: null })).toBe(false);
  });
});

describe('startedBadgeVisible', () => {
  it('true when started and not resolved', () => {
    expect(startedBadgeVisible({ resolved: false, startedAt: '2026-06-25T00:00:00Z' })).toBe(true);
  });
  it('false when not started', () => {
    expect(startedBadgeVisible({ resolved: false, startedAt: null })).toBe(false);
  });
  it('false when resolved (resolved state takes precedence)', () => {
    expect(startedBadgeVisible({ resolved: true, startedAt: '2026-06-25T00:00:00Z' })).toBe(false);
  });
});
