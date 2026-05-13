import { describe, expect, it } from 'vitest';
import { filterDashboardVisibleUsers } from './useUsers';

describe('filterDashboardVisibleUsers', () => {
  it('hides the seeded test admin account from dashboard user lists', () => {
    const users = [
      { email: 'maria@itdev.gr' },
      { email: 'test@itdev.gr' },
      { email: 'sales@itdev.gr' },
    ];

    expect(filterDashboardVisibleUsers(users)).toEqual([
      { email: 'maria@itdev.gr' },
      { email: 'sales@itdev.gr' },
    ]);
  });

  it('matches the hidden account case-insensitively', () => {
    expect(filterDashboardVisibleUsers([{ email: 'Test@ITDEV.GR' }])).toEqual([]);
  });
});
