import { describe, it, expect } from 'vitest';
import { isStageMoveBlocked } from './stageAccess';

describe('isStageMoveBlocked', () => {
  it('blocks when stage is restricted to a different user', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: 'user-A' }, 'user-B')).toBe(true);
  });

  it('allows when stage is restricted to the current user', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: 'user-A' }, 'user-A')).toBe(false);
  });

  it('allows when stage is unrestricted', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: null }, 'user-B')).toBe(false);
  });

  it('blocks a restricted stage when there is no current user', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: 'user-A' }, null)).toBe(true);
  });
});
