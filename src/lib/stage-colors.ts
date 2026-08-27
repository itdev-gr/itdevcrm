export type StageAccent = {
  badge: string;
  columnBorder: string;
  dot: string;
};

const BY_CODE: Record<string, StageAccent> = {
  unique_lead: {
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
    columnBorder: 'border-t-violet-500',
    dot: 'bg-violet-500',
  },
  new_lead: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
    columnBorder: 'border-t-sky-500',
    dot: 'bg-sky-500',
  },
  no_answer: {
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
    columnBorder: 'border-t-amber-500',
    dot: 'bg-amber-500',
  },
  constant_na: {
    badge: 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200',
    columnBorder: 'border-t-orange-500',
    dot: 'bg-orange-500',
  },
  working_on_it: {
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200',
    columnBorder: 'border-t-indigo-500',
    dot: 'bg-indigo-500',
  },
  offer_sent: {
    badge: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-200',
    columnBorder: 'border-t-cyan-500',
    dot: 'bg-cyan-500',
  },
  scheduled: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    columnBorder: 'border-t-blue-500',
    dot: 'bg-blue-500',
  },
  hot: {
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
    columnBorder: 'border-t-rose-500',
    dot: 'bg-rose-500',
  },
  won: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    columnBorder: 'border-t-emerald-500',
    dot: 'bg-emerald-500',
  },
  not_interested: {
    badge: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    columnBorder: 'border-t-zinc-400',
    dot: 'bg-zinc-400',
  },
  dead_end: {
    badge: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    columnBorder: 'border-t-zinc-500',
    dot: 'bg-zinc-500',
  },
  not_found: {
    badge: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
    columnBorder: 'border-t-stone-400',
    dot: 'bg-stone-400',
  },
  // Accounting onboarding
  new: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
    columnBorder: 'border-t-sky-500',
    dot: 'bg-sky-500',
  },
  documents_verified: {
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200',
    columnBorder: 'border-t-indigo-500',
    dot: 'bg-indigo-500',
  },
  invoice_issued: {
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
    columnBorder: 'border-t-violet-500',
    dot: 'bg-violet-500',
  },
  awaiting_payment: {
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
    columnBorder: 'border-t-amber-500',
    dot: 'bg-amber-500',
  },
  partial_payment: {
    badge: 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200',
    columnBorder: 'border-t-orange-500',
    dot: 'bg-orange-500',
  },
  paid_in_full: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    columnBorder: 'border-t-emerald-500',
    dot: 'bg-emerald-500',
  },
  on_hold: {
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
    columnBorder: 'border-t-rose-500',
    dot: 'bg-rose-500',
  },
  refunded: {
    badge: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    columnBorder: 'border-t-zinc-400',
    dot: 'bg-zinc-400',
  },
  closed: {
    badge: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200',
    columnBorder: 'border-t-teal-500',
    dot: 'bg-teal-500',
  },
  // Jobs — shared stage codes across boards
  new_project: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
    columnBorder: 'border-t-sky-500',
    dot: 'bg-sky-500',
  },
  renewal: {
    badge: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-200',
    columnBorder: 'border-t-cyan-500',
    dot: 'bg-cyan-500',
  },
  called_no_response: {
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
    columnBorder: 'border-t-amber-500',
    dot: 'bg-amber-500',
  },
  no_response: {
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
    columnBorder: 'border-t-amber-500',
    dot: 'bg-amber-500',
  },
  send_form: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    columnBorder: 'border-t-blue-500',
    dot: 'bg-blue-500',
  },
  optimize: {
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200',
    columnBorder: 'border-t-indigo-500',
    dot: 'bg-indigo-500',
  },
  rank_tracking: {
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200',
    columnBorder: 'border-t-purple-500',
    dot: 'bg-purple-500',
  },
  report: {
    badge: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200',
    columnBorder: 'border-t-teal-500',
    dot: 'bg-teal-500',
  },
  gsc_ga4_setup: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    columnBorder: 'border-t-blue-500',
    dot: 'bg-blue-500',
  },
  sitemap_schema: {
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
    columnBorder: 'border-t-violet-500',
    dot: 'bg-violet-500',
  },
  performance_monitoring: {
    badge: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-200',
    columnBorder: 'border-t-fuchsia-500',
    dot: 'bg-fuchsia-500',
  },
  onboarding: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
    columnBorder: 'border-t-sky-500',
    dot: 'bg-sky-500',
  },
  content_plan: {
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
    columnBorder: 'border-t-violet-500',
    dot: 'bg-violet-500',
  },
  active: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    columnBorder: 'border-t-emerald-500',
    dot: 'bg-emerald-500',
  },
  cancelled: {
    badge: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    columnBorder: 'border-t-zinc-400',
    dot: 'bg-zinc-400',
  },
  client_contact: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    columnBorder: 'border-t-blue-500',
    dot: 'bg-blue-500',
  },
  get_requirements: {
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200',
    columnBorder: 'border-t-indigo-500',
    dot: 'bg-indigo-500',
  },
  planning: {
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200',
    columnBorder: 'border-t-purple-500',
    dot: 'bg-purple-500',
  },
  development: {
    badge: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-200',
    columnBorder: 'border-t-cyan-500',
    dot: 'bg-cyan-500',
  },
  done: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    columnBorder: 'border-t-emerald-500',
    dot: 'bg-emerald-500',
  },
  live: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    columnBorder: 'border-t-emerald-500',
    dot: 'bg-emerald-500',
  },
  blocked: {
    badge: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200',
    columnBorder: 'border-t-red-500',
    dot: 'bg-red-500',
  },
};

const FALLBACKS: StageAccent[] = [
  {
    badge: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200',
    columnBorder: 'border-t-teal-500',
    dot: 'bg-teal-500',
  },
  {
    badge: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-200',
    columnBorder: 'border-t-fuchsia-500',
    dot: 'bg-fuchsia-500',
  },
  {
    badge: 'bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-200',
    columnBorder: 'border-t-lime-500',
    dot: 'bg-lime-500',
  },
];

export function stageAccent(code: string | null | undefined, index = 0): StageAccent {
  if (code && BY_CODE[code]) return BY_CODE[code];
  return FALLBACKS[index % FALLBACKS.length]!;
}

export const SOURCE_BADGE: Record<string, string> = {
  manual: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  meta: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
  import: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200',
  franchise: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
};
