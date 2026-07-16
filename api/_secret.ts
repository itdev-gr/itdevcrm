// api/_secret.ts
// Constant-time secret comparison for the public webhook endpoints
// (meta-lead, pbx-lookup). Length-guards first (timingSafeEqual throws on
// unequal-length buffers), then a crypto constant-time compare to avoid a
// timing side-channel on the shared secret.
import { timingSafeEqual } from 'node:crypto';

export function secretMatches(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
