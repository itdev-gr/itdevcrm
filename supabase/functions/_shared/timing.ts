// Constant-time string comparison for secrets / MACs. Mirrors the local
// helpers in resend-webhook/verify.ts and auth-email/hook.ts, hoisted to
// _shared so send-email + google can reuse it. Unit-tested under vitest.
//
// NOTE: length is compared up front (a non-constant-time leak of *length*),
// which is the standard, acceptable trade-off for the secrets here.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
