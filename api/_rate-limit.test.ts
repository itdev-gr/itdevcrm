import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, resetRateLimiter } from './_rate-limit';

describe('rateLimit (sliding window)', () => {
  beforeEach(() => resetRateLimiter());

  it('allows requests up to the limit within the window', () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit('a', opts, 1000).ok).toBe(true);
    expect(rateLimit('a', opts, 1000).ok).toBe(true);
    expect(rateLimit('a', opts, 1000).ok).toBe(true);
  });

  it('blocks the request that breaches the limit and reports retryAfterMs', () => {
    const opts = { limit: 2, windowMs: 60_000 };
    rateLimit('b', opts, 1000);
    rateLimit('b', opts, 1000);
    const r = rateLimit('b', opts, 1000);
    expect(r.ok).toBe(false);
    // Oldest hit was at t=1000; it frees up at 1000 + 60_000 = 61_000.
    if (!r.ok) expect(r.retryAfterMs).toBe(60_000);
  });

  it('lets requests through again once the window has slid past old hits', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(rateLimit('c', opts, 1000).ok).toBe(true);
    // Still inside the window → blocked.
    expect(rateLimit('c', opts, 30_000).ok).toBe(false);
    // Past the window (old hit expired) → allowed again.
    expect(rateLimit('c', opts, 61_001).ok).toBe(true);
  });

  it('tracks each key independently', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(rateLimit('x', opts, 1000).ok).toBe(true);
    expect(rateLimit('y', opts, 1000).ok).toBe(true);
    expect(rateLimit('x', opts, 1000).ok).toBe(false);
  });
});
