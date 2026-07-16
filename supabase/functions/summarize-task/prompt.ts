// Pure helpers for the summarize-task Edge Function. No Deno APIs — importable
// from a plain Deno test. `buildSummaryInput` shapes the LLM user message;
// `SYSTEM_PROMPT` is the exact Greek archival instruction (do not edit wording).

// Verbatim from the dual-resolve spec (task-6 brief). Keep byte-identical.
export const SYSTEM_PROMPT =
  'Είσαι βοηθός αρχειοθέτησης σε CRM. Γράψε σύντομη τεκμηριωμένη σύνοψη (3-5 γραμμές, ελληνικά) της συζήτησης ενός task: τι ζητήθηκε, τι έγινε, τι αποφασίστηκε, τυχόν εκκρεμότητες. Χωρίς χαιρετισμούς, χωρίς αυτούσια παραθέματα, χωρίς ονόματα σε κάθε γραμμή.';

export interface SummaryTask {
  title: string;
  // assigned_tasks.description OR user_tasks.notes — whichever the kind carries.
  description: string | null;
}

export interface SummaryComment {
  authorName: string;
  createdAt: string; // ISO timestamp
  body: string;
}

// Cap the user message so a very long thread can't blow the token budget /
// context window. Measured on the whole returned string.
const MAX_INPUT = 12000;
// Prepended (after the header) when older comments were dropped.
const OMIT_MARKER = '…(παλαιότερα σχόλια παραλείφθηκαν)';

// dd/MM HH:mm in UTC — deterministic across the edge runtime (UTC) and any
// local test host. This is only LLM context; the summary itself omits per-line
// names/times by instruction.
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Header + `«Name (dd/MM HH:mm): body»` lines oldest-first. When the whole
// thing would exceed MAX_INPUT, drop the OLDEST comment lines (from the front)
// and prepend OMIT_MARKER so the model knows earlier context is missing.
export function buildSummaryInput(task: SummaryTask, comments: SummaryComment[]): string {
  const header = `Task: ${task.title}\nΠεριγραφή: ${task.description ?? ''}\n`;
  const lines = comments.map(
    (c) => `«${c.authorName} (${fmtDate(c.createdAt)}): ${c.body}»`,
  );

  const full = header + lines.join('\n');
  if (full.length <= MAX_INPUT) return full;

  // Budget for kept comment lines once the header + marker (+ its newline) are
  // reserved. Keep the NEWEST lines that fit, walking from the end backwards.
  const budget = MAX_INPUT - header.length - OMIT_MARKER.length - 1;
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + (kept.length > 0 ? 1 : 0); // + joining newline
    if (used + cost > budget) break;
    kept.unshift(lines[i]);
    used += cost;
  }

  // Degenerate case: even the single newest line overflows the budget —
  // hard-truncate it to its tail so we still emit something bounded.
  let bodyStr: string;
  if (kept.length === 0) {
    const newest = lines[lines.length - 1] ?? '';
    bodyStr = newest.slice(Math.max(0, newest.length - Math.max(budget, 0)));
  } else {
    bodyStr = kept.join('\n');
  }

  // Pathological header: the title+description header plus the marker alone would
  // already exceed MAX_INPUT (budget < 0, so bodyStr is empty). Hard-clamp the
  // header so the returned string is always ≤ MAX_INPUT. Non-pathological output
  // (budget ≥ 0) is left byte-identical.
  const safeHeader = budget < 0
    ? header.slice(0, Math.max(0, MAX_INPUT - OMIT_MARKER.length - 1))
    : header;
  return `${safeHeader}${OMIT_MARKER}\n${bodyStr}`;
}
