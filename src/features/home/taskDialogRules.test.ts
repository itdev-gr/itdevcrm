import { describe, it, expect } from 'vitest';
import { taskLinkMode, filterTaskAssignees } from './taskDialogRules';

const base = {
  isSales: false,
  editLeadId: null,
  editClientId: null,
  hasDefaultLead: false,
  hasDefaultClient: false,
};

describe('taskLinkMode', () => {
  it('defaults to client mode for non-sales users', () => {
    expect(taskLinkMode(base)).toBe('client');
  });
  it('sales users get lead mode when creating', () => {
    expect(taskLinkMode({ ...base, isSales: true })).toBe('lead');
  });
  it('editing a lead-linked task is lead mode regardless of role', () => {
    expect(taskLinkMode({ ...base, editLeadId: 'L1' })).toBe('lead');
  });
  it('editing a client-linked task is client mode even for sales', () => {
    expect(taskLinkMode({ ...base, isSales: true, editClientId: 'C1' })).toBe('client');
  });
  it('a default lead (lead Tasks tab) forces lead mode', () => {
    expect(taskLinkMode({ ...base, hasDefaultLead: true })).toBe('lead');
  });
  it('a default client (client Tasks tab) forces client mode even for sales', () => {
    expect(taskLinkMode({ ...base, isSales: true, hasDefaultClient: true })).toBe('client');
  });
  it('a default lead wins over a default client', () => {
    expect(taskLinkMode({ ...base, hasDefaultLead: true, hasDefaultClient: true })).toBe('lead');
  });
  it('an existing lead link wins over an existing client link', () => {
    expect(taskLinkMode({ ...base, editLeadId: 'L1', editClientId: 'C1' })).toBe('lead');
  });
});

describe('filterTaskAssignees', () => {
  const owners = [
    { user_id: 'a', is_admin: true, group_codes: [] },
    { user_id: 's', is_admin: false, group_codes: ['sales'] },
    { user_id: 'acc', is_admin: false, group_codes: ['accounting'] },
    { user_id: 'tech', is_admin: false, group_codes: ['web_seo'] },
    { user_id: 'multi', is_admin: false, group_codes: ['web_dev', 'sales'] },
  ];
  it('unrestricted returns everyone', () => {
    expect(filterTaskAssignees(owners, false)).toHaveLength(5);
  });
  it('restricted keeps admins, sales and accounting only', () => {
    const ids = filterTaskAssignees(owners, true).map((o) => o.user_id);
    expect(ids).toEqual(['a', 's', 'acc', 'multi']);
  });
});
