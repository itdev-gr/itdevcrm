import { describe, it, expect } from 'vitest';
import { ADOPTION_WINDOW_MS, newCrmMessageId, isUnadoptedMirrorId, nearestBySentAt } from './emailDedup';

describe('emailDedup helpers', () => {
  it('formats a CRM message id as an RFC822 msg-id on our domain', () => {
    expect(newCrmMessageId('123e4567-e89b-12d3-a456-426614174000'))
      .toBe('<crm-123e4567-e89b-12d3-a456-426614174000@itdev.gr>');
  });

  it('generates unique ids when no uuid is given', () => {
    const a = newCrmMessageId();
    expect(a).toMatch(/^<crm-[0-9a-f-]{36}@itdev\.gr>$/);
    expect(newCrmMessageId()).not.toBe(a);
  });

  it('recognizes un-adopted mirror ids (both schemes) and nothing else', () => {
    expect(isUnadoptedMirrorId('resend:abc-123')).toBe(true);
    expect(isUnadoptedMirrorId('<crm-123e4567-e89b-12d3-a456-426614174000@itdev.gr>')).toBe(true);
    expect(isUnadoptedMirrorId('<xyz@eu-west-1.amazonses.com>')).toBe(false);
    expect(isUnadoptedMirrorId('<abc@mail.gmail.com>')).toBe(false);
  });

  it('picks the nearest row by sent_at within the adoption window', () => {
    const rows = [
      { id: 'far', sent_at: '2026-07-29T06:20:00Z' },
      { id: 'near', sent_at: '2026-07-29T06:00:30Z' },
      { id: 'null', sent_at: null },
    ];
    expect(nearestBySentAt(rows, '2026-07-29T06:00:00Z')?.id).toBe('near');
  });

  it('returns undefined when every candidate is outside the window', () => {
    const rows = [{ id: 'a', sent_at: '2026-07-29T07:00:01Z' }];
    expect(nearestBySentAt(rows, '2026-07-29T06:00:00Z')).toBeUndefined();
    expect(ADOPTION_WINDOW_MS).toBe(30 * 60_000);
  });
});
