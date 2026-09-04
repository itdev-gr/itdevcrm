import { describe, expect, it } from 'vitest';
import { isToastable } from './toastableTypes';

describe('isToastable', () => {
  it('returns true for every toastable notification type', () => {
    expect(isToastable('task_assigned')).toBe(true);
    expect(isToastable('task_comment')).toBe(true);
    expect(isToastable('job_created')).toBe(true);
    expect(isToastable('job_archived')).toBe(true);
    expect(isToastable('task_confirm_pending')).toBe(true);
  });

  it('returns false for non-toastable notification types', () => {
    expect(isToastable('mention')).toBe(false);
    expect(isToastable('task_started')).toBe(false);
    expect(isToastable('task_resolved')).toBe(false);
    expect(isToastable('payment_overdue')).toBe(false);
    expect(isToastable('something_arbitrary')).toBe(false);
    expect(isToastable('')).toBe(false);
  });
});
