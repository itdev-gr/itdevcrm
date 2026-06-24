export type AnnouncementSeverity = 'info' | 'warning';

export type NewAnnouncementInput = {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  targetAll: boolean;
  groupIds: string[];
  expiresAt: string; // '' or 'yyyy-mm-dd'
};

export type NewAnnouncementError = 'missing_title' | 'missing_body' | 'missing_target';

export type CreateAnnouncementParams = {
  p_title: string;
  p_body: string;
  p_severity: AnnouncementSeverity;
  p_target_all: boolean;
  p_group_ids: string[];
  p_expires_at: string | null;
};

export function validateNewAnnouncement(input: NewAnnouncementInput): NewAnnouncementError[] {
  const errors: NewAnnouncementError[] = [];
  if (input.title.trim() === '') errors.push('missing_title');
  if (input.body.trim() === '') errors.push('missing_body');
  if (!input.targetAll && input.groupIds.length === 0) errors.push('missing_target');
  return errors;
}

export function buildCreateAnnouncementParams(input: NewAnnouncementInput): CreateAnnouncementParams {
  const expires = input.expiresAt.trim();
  return {
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_severity: input.severity,
    p_target_all: input.targetAll,
    p_group_ids: input.targetAll ? [] : input.groupIds,
    p_expires_at: expires === '' ? null : expires,
  };
}
