import { describe, it, expect } from 'vitest';
import {
  validateNewAnnouncement,
  buildCreateAnnouncementParams,
  type NewAnnouncementInput,
} from './announcement';

const base: NewAnnouncementInput = {
  title: 'Heads up',
  body: 'The office is closed Friday.',
  severity: 'info',
  targetAll: true,
  groupIds: [],
  expiresAt: '',
};

describe('validateNewAnnouncement', () => {
  it('passes for a valid all-users announcement', () => {
    expect(validateNewAnnouncement(base)).toEqual([]);
  });
  it('requires a title', () => {
    expect(validateNewAnnouncement({ ...base, title: '  ' })).toEqual(['missing_title']);
  });
  it('requires a body', () => {
    expect(validateNewAnnouncement({ ...base, body: '' })).toEqual(['missing_body']);
  });
  it('requires a target when not all-users', () => {
    expect(
      validateNewAnnouncement({ ...base, targetAll: false, groupIds: [] }),
    ).toEqual(['missing_target']);
  });
  it('passes for a valid group-targeted announcement', () => {
    expect(
      validateNewAnnouncement({ ...base, targetAll: false, groupIds: ['g1'] }),
    ).toEqual([]);
  });
});

describe('buildCreateAnnouncementParams', () => {
  it('maps an all-users announcement (no groups, no expiry)', () => {
    expect(buildCreateAnnouncementParams({ ...base, title: ' Heads up ', body: ' hi ' })).toEqual({
      p_title: 'Heads up',
      p_body: 'hi',
      p_severity: 'info',
      p_target_all: true,
      p_group_ids: [],
      p_expires_at: null,
    });
  });
  it('maps a group-targeted announcement with expiry', () => {
    expect(
      buildCreateAnnouncementParams({
        ...base,
        severity: 'warning',
        targetAll: false,
        groupIds: ['g1', 'g2'],
        expiresAt: '2026-07-01',
      }),
    ).toEqual({
      p_title: 'Heads up',
      p_body: 'The office is closed Friday.',
      p_severity: 'warning',
      p_target_all: false,
      p_group_ids: ['g1', 'g2'],
      p_expires_at: '2026-07-01',
    });
  });
});
