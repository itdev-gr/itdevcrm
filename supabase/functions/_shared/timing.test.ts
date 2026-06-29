import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from './timing';

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('s3cr3t-token', 's3cr3t-token')).toBe(true);
  });

  it('returns false for different same-length strings', () => {
    expect(timingSafeEqual('s3cr3t-token', 's3cr3t-toketX'.slice(0, 12))).toBe(false);
    expect(timingSafeEqual('aaaa', 'aaab')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeEqual('short', 'longer-value')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });

  it('returns true for two empty strings (caller must guard empties)', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
