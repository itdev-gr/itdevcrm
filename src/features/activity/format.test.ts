import { describe, it, expect } from 'vitest';
import {
  labelFor,
  formatValue,
  diffOf,
  describeActor,
  HIDDEN_FIELDS,
  type Resolver,
} from './format';

const resolver: Resolver = {
  stages: [
    { id: 'stage-hot', code: 'hot', display_names: { en: 'Hot', el: 'Καυτό' } },
    { id: 'stage-new', code: 'new_lead', display_names: { en: 'New Lead', el: 'Νέος' } },
  ],
  users: [{ user_id: 'u1', full_name: 'Giorgos Andris', email: 'g@itdev.gr' }],
  lang: 'en',
};

describe('labelFor', () => {
  it('uses friendly labels for known fields', () => {
    expect(labelFor('stage_id')).toBe('Stage');
    expect(labelFor('estimated_monthly_value')).toBe('Monthly value');
  });
  it('humanizes unknown snake_case fields (never shows raw column names)', () => {
    expect(labelFor('some_future_flag')).toBe('Some future flag');
    expect(labelFor('reviewed_by_id')).toBe('Reviewed by');
  });
});

describe('formatValue — no data types leak', () => {
  it('renders booleans as Yes/No', () => {
    expect(formatValue(true, 'is_blocked', resolver)).toBe('Yes');
    expect(formatValue(false, 'archived', resolver)).toBe('No');
  });
  it('renders empty/null as a dash', () => {
    expect(formatValue(null, 'owner_user_id', resolver)).toBe('—');
    expect(formatValue('', 'phone', resolver)).toBe('—');
  });
  it('resolves stage ids to names', () => {
    expect(formatValue('stage-hot', 'stage_id', resolver)).toBe('Hot');
  });
  it('resolves user ids to names', () => {
    expect(formatValue('u1', 'owner_user_id', resolver)).toBe('Giorgos Andris');
    expect(formatValue('ghost', 'owner_user_id', resolver)).toBe('Unknown user');
  });
  it('formats money fields with €', () => {
    expect(formatValue(150, 'estimated_monthly_value', resolver)).toBe('€150');
    expect(formatValue(0, 'one_time_value', resolver)).toBe('€0');
  });
  it('maps enum codes to friendly values', () => {
    expect(formatValue('web_seo', 'service_type', resolver)).toBe('Web SEO');
    expect(formatValue('recurring_monthly', 'billing_type', resolver)).toBe('Monthly');
  });
  it('formats dates without raw ISO', () => {
    expect(formatValue('2026-06-18', 'expected_close_date', resolver)).toBe('18/06/2026');
  });
  it('summarizes service arrays by name, not JSON', () => {
    expect(formatValue([{ service_type: 'web_seo' }, { service_type: 'ads' }], 'services_planned', resolver)).toBe(
      'Web SEO, Ads',
    );
  });
  it('never dumps raw JSON for objects', () => {
    expect(formatValue({ a: 1, b: 2 }, 'details', resolver)).toBe('updated');
  });
});

describe('diffOf', () => {
  it('lists changed fields and skips hidden/system ones', () => {
    const changes = {
      old: { stage_id: 'stage-hot', updated_at: 'x', is_blocked: false },
      new: { stage_id: 'stage-new', updated_at: 'y', is_blocked: true },
    };
    const diffs = diffOf(changes);
    expect(diffs.map((d) => d.field).sort()).toEqual(['is_blocked', 'stage_id']);
    expect(HIDDEN_FIELDS.has('updated_at')).toBe(true);
  });
});

describe('describeActor — always shows who', () => {
  it('uses full name when present', () => {
    expect(describeActor({ user_id: 'u1', user: { full_name: 'Maria K', email: 'm@x.gr' } })).toBe('Maria K');
  });
  it('falls back to email when name is blank (the bug we fixed)', () => {
    expect(describeActor({ user_id: 'u1', user: { full_name: '', email: 'm@x.gr' } })).toBe('m@x.gr');
  });
  it('shows System for automated changes with no user', () => {
    expect(describeActor({ user_id: null, user: null })).toBe('System');
  });
  it('shows Unknown user when the user id has no profile', () => {
    expect(describeActor({ user_id: 'gone', user: null })).toBe('Unknown user');
  });
});

import { categoryOf, describeEvent } from './format';

describe('categoryOf', () => {
  it('maps entity types to feed categories', () => {
    expect(categoryOf('deal_payments')).toBe('payment');
    expect(categoryOf('jobs')).toBe('job');
    expect(categoryOf('deals')).toBe('deal');
    expect(categoryOf('attachments')).toBe('attachment');
    expect(categoryOf('user_tasks')).toBe('task');
    expect(categoryOf('assigned_tasks')).toBe('task');
    expect(categoryOf('email_log')).toBe('email');
    expect(categoryOf('something_else')).toBe('other');
  });
});

describe('describeEvent — payments', () => {
  it('describes a new pending payment', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'insert', changes: { amount_net: '346.78', status: 'pending' } },
      resolver,
    );
    expect(v.category).toBe('payment');
    expect(v.summary).toBe('Payment of €346.78 created (pending)');
  });
  it('describes marking a payment paid', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'update',
        changes: { old: { amount_net: '346.78', status: 'pending' }, new: { amount_net: '346.78', status: 'paid' } } },
      resolver,
    );
    expect(v.summary).toBe('Payment of €346.78 marked paid');
  });
  it('describes setting a payment back to pending', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'update',
        changes: { old: { amount_net: '346.78', status: 'paid' }, new: { amount_net: '346.78', status: 'pending' } } },
      resolver,
    );
    expect(v.summary).toBe('Payment of €346.78 set back to pending');
  });
  it('describes a payment amount change', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'update',
        changes: { old: { amount_net: '300', status: 'pending' }, new: { amount_net: '346.78', status: 'pending' } } },
      resolver,
    );
    expect(v.summary).toBe('Payment amount changed €300 → €346.78');
  });
  it('describes a deleted payment', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'delete', changes: { amount_net: '346.78', status: 'pending' } },
      resolver,
    );
    expect(v.summary).toBe('Payment of €346.78 deleted');
  });
});

describe('describeEvent — tasks', () => {
  it('describes a created task', () => {
    const v = describeEvent(
      { entity_type: 'user_tasks', action: 'insert', changes: { title: 'Call client', completed_at: null } },
      resolver,
    );
    expect(v.category).toBe('task');
    expect(v.summary).toBe('Task “Call client” created');
  });
  it('describes a completed user task (completed_at set)', () => {
    const v = describeEvent(
      { entity_type: 'user_tasks', action: 'update',
        changes: { old: { title: 'Call client', completed_at: null }, new: { title: 'Call client', completed_at: '2026-06-25T10:00:00Z' } } },
      resolver,
    );
    expect(v.summary).toBe('Task “Call client” completed');
  });
  it('describes a resolved assigned task (status → resolved)', () => {
    const v = describeEvent(
      { entity_type: 'assigned_tasks', action: 'update',
        changes: { old: { title: 'Fix DNS', status: 'open' }, new: { title: 'Fix DNS', status: 'resolved' } } },
      resolver,
    );
    expect(v.summary).toBe('Task “Fix DNS” completed');
  });
});

describe('describeEvent — attachments', () => {
  it('describes an upload', () => {
    const v = describeEvent(
      { entity_type: 'attachments', action: 'insert', changes: { file_name: 'invoice.pdf', parent_type: 'client' } },
      resolver,
    );
    expect(v.category).toBe('attachment');
    expect(v.summary).toBe('Uploaded invoice.pdf');
  });
  it('describes a delete', () => {
    const v = describeEvent(
      { entity_type: 'attachments', action: 'delete', changes: { file_name: 'invoice.pdf' } },
      resolver,
    );
    expect(v.summary).toBe('Deleted invoice.pdf');
  });
});

describe('describeEvent — generic deal/job', () => {
  it('describes a deal stage move using friendly stage names', () => {
    const v = describeEvent(
      { entity_type: 'deals', action: 'update',
        changes: { old: { stage_id: 'stage-new' }, new: { stage_id: 'stage-hot' } } },
      resolver,
    );
    expect(v.category).toBe('deal');
    expect(v.summary).toBe('Updated the deal:');
    expect(v.lines[0]).toEqual({ key: 'stage_id', label: 'Stage', text: 'New Lead → Hot' });
  });
  it('describes a created job', () => {
    const v = describeEvent(
      { entity_type: 'jobs', action: 'insert', changes: { service_type: 'web_seo', status: 'active' } },
      resolver,
    );
    expect(v.summary).toBe('Created the job');
  });
});
