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
