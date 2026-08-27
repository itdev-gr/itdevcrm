import { describe, it, expect } from 'vitest';
import { groupCronAlerts, cronAlertKindLabel, cronAlertLink, type CronAlertRow } from './cronAlertPresenters';

const mk = (o: Partial<CronAlertRow>): CronAlertRow => ({
  id: 'r1',
  kind: 'flip_out_of_paid_in_full',
  subject_type: 'deal',
  subject_id: 's1',
  details: {},
  detected_at: '2026-08-01T00:00:00Z',
  resolved_at: null,
  resolved_by: null,
  ...o,
});

describe('groupCronAlerts', () => {
  it('groups rows by kind with a count and the oldest detected_at', () => {
    const groups = groupCronAlerts([
      mk({ id: 'a', kind: 'flip_out_of_paid_in_full', detected_at: '2026-08-05T00:00:00Z' }),
      mk({ id: 'b', kind: 'flip_out_of_paid_in_full', detected_at: '2026-07-01T00:00:00Z' }),
      mk({ id: 'c', kind: 'duplicate_period', detected_at: '2026-08-10T00:00:00Z' }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['flip_out_of_paid_in_full', 'duplicate_period']);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.oldest).toBe('2026-07-01T00:00:00Z');
    // rows within a group are also oldest-first
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('orders groups oldest-open-row-first', () => {
    const groups = groupCronAlerts([
      mk({ id: 'a', kind: 'duplicate_period', detected_at: '2026-08-20T00:00:00Z' }),
      mk({ id: 'b', kind: 'flip_out_of_paid_in_full', detected_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['flip_out_of_paid_in_full', 'duplicate_period']);
  });

  it('returns an empty array for no rows', () => {
    expect(groupCronAlerts([])).toEqual([]);
  });
});

describe('cronAlertKindLabel', () => {
  it('labels the two known cron checks', () => {
    expect(cronAlertKindLabel('duplicate_period')).toBe('Duplicate billing period');
    expect(cronAlertKindLabel('flip_out_of_paid_in_full')).toBe('Flipped out of Paid In Full');
  });

  it('falls back to a humanized raw kind for an unknown check', () => {
    expect(cronAlertKindLabel('some_new_check')).toBe('some new check');
  });
});

describe('cronAlertLink', () => {
  it('links a deal-subject row to its deal', () => {
    expect(cronAlertLink(mk({ subject_type: 'deal', subject_id: 'D1' }))).toBe('/deals/D1');
  });

  it('returns null for a subject_type it does not know how to route', () => {
    expect(cronAlertLink(mk({ subject_type: 'widget', subject_id: 'W1' }))).toBeNull();
  });
});
