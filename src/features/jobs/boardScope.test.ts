import { describe, it, expect } from 'vitest';
import { isOwnerOnlyBoard } from './boardScope';

describe('isOwnerOnlyBoard', () => {
  it('social_media and ads are owner-only', () => {
    expect(isOwnerOnlyBoard('social_media')).toBe(true);
    expect(isOwnerOnlyBoard('ads')).toBe(true);
  });

  it('all other boards keep the group-wide toggle', () => {
    for (const board of ['web_seo', 'local_seo', 'web_dev', 'ai_seo', 'hosting', 'maintenance', 'franchise', 'domains'] as const) {
      expect(isOwnerOnlyBoard(board)).toBe(false);
    }
  });
});
