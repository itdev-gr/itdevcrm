// Recipient-list parsing shared by the send-email edge fn (validation), the
// gmail-sync capture (header parsing), and the frontend compose dialog
// (client-side validation). Dependency-free — importable by Deno and Vite.

const ADDR_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_RECIPIENTS = 10;

/**
 * Strict validation for caller-supplied cc/bcc. Accepts a comma-separated
 * string or an array of strings. Returns lowercased, deduped emails; [] when
 * absent/empty; null when ANY entry is invalid, contains CR/LF, or the list
 * exceeds 10 — callers must reject the request on null.
 */
export function parseRecipientList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  let parts: string[];
  if (typeof v === 'string') {
    if (/[\r\n]/.test(v)) return null;
    parts = v.split(',');
  } else if (Array.isArray(v)) {
    if (!v.every((x) => typeof x === 'string')) return null;
    if (v.some((x) => /[\r\n]/.test(x))) return null;
    parts = v;
  } else {
    return null;
  }
  const out: string[] = [];
  for (const p of parts) {
    const e = p.trim().toLowerCase();
    if (e === '') continue;
    if (!ADDR_RE.test(e)) return null;
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) return null;
  return out;
}

/**
 * Lenient parsing for captured mail headers ("Name" <a@b.gr>, c@d.gr, …).
 * Splits on commas OUTSIDE double quotes, extracts the mailbox from <…> or
 * a bare address, lowercases, drops fragments that yield no valid address.
 */
export function parseAddressList(header: string): string[] {
  if (!header) return [];
  const parts: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/<([^>]+)>/);
    const cand = (m ? m[1]! : p).trim().toLowerCase();
    if (ADDR_RE.test(cand) && !out.includes(cand)) out.push(cand);
  }
  return out;
}
