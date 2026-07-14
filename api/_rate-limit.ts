// In-memory sliding-window rate limiter for the public intake API.
//
// Ported from info-website-main (`src/lib/rate-limit.ts`). A single Vercel
// serverless instance keeps its own `store`; this is intentionally best-effort
// abuse throttling, not a strict distributed limit. `now` is injectable so the
// window behaviour can be unit-tested without fake timers.
interface Options {
  limit: number;
  windowMs: number;
}

type HitLog = number[];

const store = new Map<string, HitLog>();

export function rateLimit(
  key: string,
  { limit, windowMs }: Options,
  now: number = Date.now(),
): { ok: true } | { ok: false; retryAfterMs: number } {
  const cutoff = now - windowMs;
  const existing = (store.get(key) ?? []).filter((t) => t > cutoff);

  if (existing.length >= limit) {
    const oldest = existing[0] ?? now;
    store.set(key, existing);
    return { ok: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }

  existing.push(now);
  store.set(key, existing);
  return { ok: true };
}

/** Test-only: clear all recorded hits so cases don't leak state into each other. */
export function resetRateLimiter(): void {
  store.clear();
}
