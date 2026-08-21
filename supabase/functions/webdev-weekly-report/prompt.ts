// Pure helpers for the webdev-weekly-report Edge Function. No Deno APIs — the
// facts block is built deterministically in index.ts; the LLM only writes the
// narrative on top of it (it never invents numbers the email will show).

export const SYSTEM_PROMPT =
  'Είσαι ο βοηθός αναφορών του τμήματος Web Development ενός digital agency. ' +
  'Θα λάβεις δομημένα στοιχεία για τα ενεργά web dev έργα της εβδομάδας: στάδιο ανά έργο, ' +
  'μετακινήσεις σταδίου, νέα/ολοκληρωμένα έργα, ανοιχτά tasks και σημάδια καθυστέρησης. ' +
  'Γράψε στα ελληνικά, επαγγελματικά και χωρίς χαιρετισμούς. ' +
  'Απάντησε ΑΥΣΤΗΡΑ σε JSON με σχήμα: ' +
  '{"overview": string, "attention": string[]} — ' +
  '`overview`: 3-6 προτάσεις γενική εικόνα της εβδομάδας (πρόοδος, ρυθμός, τι πήγε καλά). ' +
  '`attention`: 0-6 σύντομα σημεία για έργα που καθυστερούν, είναι κολλημένα ή περιμένουν ' +
  'ενέργεια (πελάτη ή δική μας), με το όνομα του έργου/πελάτη σε κάθε σημείο. ' +
  'Μην επινοείς αριθμούς ή έργα που δεν υπάρχουν στα στοιχεία. Αν η εβδομάδα ήταν στάσιμη, πες το ευθέως.';

export interface ProjectFact {
  code: string;
  client: string;
  stage: string;
  daysInStage: number | null;
  daysSinceTouch: number;
  openTasks: number;
  tasksResolvedThisWeek: number;
  commentsThisWeek: number;
  weekNote: string; // "planning → development", "νέο έργο", "live", "" …
  flags: string[]; // 'stuck' | 'blocked' | 'stale' | 'waiting_client'
}

export interface ReportFacts {
  weekLabel: string;
  totals: {
    active: number;
    newThisWeek: number;
    movedThisWeek: number;
    completedThisWeek: number;
    flagged: number;
  };
  projects: ProjectFact[];
}

// Cap the LLM input so a pathological board (hundreds of projects) can't blow
// the context window. Projects beyond the cap are summarized by count only.
const MAX_PROJECT_LINES = 80;

export function buildReportInput(f: ReportFacts): string {
  const head =
    `Εβδομάδα: ${f.weekLabel}\n` +
    `Σύνολα: ενεργά=${f.totals.active}, νέα=${f.totals.newThisWeek}, ` +
    `μετακινήθηκαν=${f.totals.movedThisWeek}, ολοκληρώθηκαν=${f.totals.completedThisWeek}, ` +
    `με σημαία προσοχής=${f.totals.flagged}\n`;
  const lines = f.projects.slice(0, MAX_PROJECT_LINES).map((p) => {
    const bits = [
      `στάδιο=${p.stage}`,
      p.daysInStage !== null ? `ημέρες στο στάδιο=${p.daysInStage}` : null,
      `ημέρες χωρίς κίνηση=${p.daysSinceTouch}`,
      `ανοιχτά tasks=${p.openTasks}`,
      p.tasksResolvedThisWeek > 0 ? `tasks που έκλεισαν=${p.tasksResolvedThisWeek}` : null,
      p.commentsThisWeek > 0 ? `σχόλια εβδομάδας=${p.commentsThisWeek}` : null,
      p.weekNote ? `εβδομάδα: ${p.weekNote}` : null,
      p.flags.length > 0 ? `σημαίες: ${p.flags.join(',')}` : null,
    ].filter(Boolean);
    return `- ${p.code || '—'} (${p.client}): ${bits.join(', ')}`;
  });
  const omitted = f.projects.length - Math.min(f.projects.length, MAX_PROJECT_LINES);
  const tail = omitted > 0 ? `\n…και ${omitted} ακόμη έργα (παραλείφθηκαν).` : '';
  return head + lines.join('\n') + tail;
}
