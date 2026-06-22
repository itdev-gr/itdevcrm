import { describe, it, expect } from 'vitest';
import { readPath } from './notification-presenters';

describe('readPath', () => {
  it('maps existing parent types', () => {
    expect(readPath('deal', 'd1')).toBe('/deals/d1');
    expect(readPath('job', 'j1')).toBe('/jobs/j1');
  });
  it('maps user_task to the tasks page', () => {
    expect(readPath('user_task', 'u1')).toBe('/tasks');
  });
  it('returns null for a non-string id', () => {
    expect(readPath('deal', null)).toBeNull();
  });
});
