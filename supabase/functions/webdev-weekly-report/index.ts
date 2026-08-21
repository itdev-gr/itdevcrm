// deno-lint-ignore-file no-explicit-any
// webdev-weekly-report — builds the weekly Web Dev status report and enqueues
// it as ONE email_outbox row for the department lead. The numbers in the email
// are computed here from jobs/activity_log/assigned_tasks; OpenAI only writes
// the narrative (overview + attention bullets) on top of those facts, so the
// report never shows an invented figure. If the LLM call fails the report
// still ships with a deterministic overview.
//
// Trigger: weekly pg_cron (Monday) POSTs `{run:true}` with a
// `Bearer <WEBDEV_REPORT_SECRET>` header. `{run:true, test:true}` sends an
// out-of-schedule copy with a unique dedupe key (used for manual previews).
// Auth + client shape mirror summarize-task/index.ts.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { timingSafeEqual } from '../_shared/timing.ts';
import { buildReportInput, SYSTEM_PROMPT, type ProjectFact, type ReportFacts } from './prompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REPORT_SECRET = Deno.env.get('WEBDEV_REPORT_SECRET') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
// Single recipient by owner decision (2026-08-17): the report goes ONLY to the
// department lead. Widen via the WEBDEV_REPORT_TO secret, never via request body.
const REPORT_TO = Deno.env.get('WEBDEV_REPORT_TO') ?? 'mkifokeris@itdev.gr';

const admin = createClient(URL, SERVICE_KEY);

const DAY_MS = 86_400_000;
const STALE_DAYS = 14;

function isoWeekKey(d: Date): string {
  // ISO-8601 week number (Thursday rule), used as the idempotency key so a
  // cron retry within the same week can never send twice.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const MONTHS_EL = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
function fmtDayEl(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_EL[d.getUTCMonth()]}`;
}

type StageRow = { id: string; code: string; display_names: any; position: number; is_terminal: boolean };

async function buildFacts(now: Date): Promise<ReportFacts & { dealIdByJob: Map<string, string> }> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const sinceIso = since.toISOString();
  const stageLookback = new Date(now.getTime() - 120 * DAY_MS).toISOString();

  // Stages of the web_dev board (archived legacy stages included — history
  // rows may still reference them).
  const { data: stageRows, error: sErr } = await admin
    .from('pipeline_stages')
    .select('id, code, display_names, position, is_terminal')
    .eq('board', 'web_dev');
  if (sErr) throw new Error(`load stages: ${sErr.message}`);
  const stageById = new Map<string, StageRow>();
  for (const s of (stageRows ?? []) as StageRow[]) stageById.set(s.id, s);
  const stageName = (id: string | null): string => {
    const s = id ? stageById.get(id) : undefined;
    return s ? String(s.display_names?.el ?? s.display_names?.en ?? s.code) : '—';
  };

  // Board jobs: everything currently running, plus anything completed inside
  // the window (so "ολοκληρώθηκε" still shows the week it went live).
  const { data: jobRows, error: jErr } = await admin
    .from('jobs')
    .select('id, code, client_id, deal_id, stage_id, status, is_blocked, blocked_reason, created_at, updated_at, started_at, completed_at')
    .eq('service_type', 'web_dev')
    .eq('archived', false)
    .or(`status.in.(active,paused),completed_at.gte.${sinceIso}`);
  if (jErr) throw new Error(`load jobs: ${jErr.message}`);
  const jobs = (jobRows ?? []) as any[];
  const jobIds = jobs.map((j) => j.id);
  const dealIdByJob = new Map<string, string>(jobs.map((j) => [j.id, j.deal_id]));

  // Client names.
  const clientIds = [...new Set(jobs.map((j) => j.client_id).filter(Boolean))];
  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clients, error: cErr } = await admin
      .from('clients').select('id, name').in('id', clientIds);
    if (cErr) throw new Error(`load clients: ${cErr.message}`);
    for (const c of (clients ?? []) as any[]) clientNameById.set(c.id, c.name ?? '—');
  }

  // Stage moves from the activity trigger log: newest-first, capped, 120d
  // lookback. Yields both the week's movement and each job's days-in-stage.
  const lastStageChange = new Map<string, { at: number; from: string; to: string }>();
  const movesThisWeek = new Map<string, { from: string; to: string }>();
  if (jobIds.length > 0) {
    const { data: acts, error: aErr } = await admin
      .from('activity_log')
      .select('entity_id, created_at, changes')
      .eq('entity_type', 'jobs')
      .eq('action', 'update')
      .in('entity_id', jobIds)
      .gte('created_at', stageLookback)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (aErr) throw new Error(`load activity: ${aErr.message}`);
    for (const a of (acts ?? []) as any[]) {
      const oldStage = a.changes?.old?.stage_id ?? null;
      const newStage = a.changes?.new?.stage_id ?? null;
      if (oldStage === newStage) continue;
      const at = new Date(a.created_at).getTime();
      const prev = lastStageChange.get(a.entity_id);
      if (!prev || at > prev.at) {
        lastStageChange.set(a.entity_id, { at, from: stageName(oldStage), to: stageName(newStage) });
      }
      // Newest move inside the window wins as the week's headline for the job.
      if (a.created_at >= sinceIso && !movesThisWeek.has(a.entity_id)) {
        movesThisWeek.set(a.entity_id, { from: stageName(oldStage), to: stageName(newStage) });
      }
    }
  }

  // Task load per job (open now / resolved inside the window).
  const openTasks = new Map<string, number>();
  const resolvedTasks = new Map<string, number>();
  if (jobIds.length > 0) {
    const { data: tasks, error: tErr } = await admin
      .from('assigned_tasks')
      .select('job_id, status, resolved_at')
      .in('job_id', jobIds);
    if (tErr) throw new Error(`load tasks: ${tErr.message}`);
    for (const t of (tasks ?? []) as any[]) {
      if (t.status === 'open') openTasks.set(t.job_id, (openTasks.get(t.job_id) ?? 0) + 1);
      else if (t.resolved_at && t.resolved_at >= sinceIso) {
        resolvedTasks.set(t.job_id, (resolvedTasks.get(t.job_id) ?? 0) + 1);
      }
    }
  }

  // Week's comment volume: web_dev job threads live on the deal's Dev channel.
  const commentsByDeal = new Map<string, number>();
  const dealIds = [...new Set(jobs.map((j) => j.deal_id).filter(Boolean))];
  if (dealIds.length > 0) {
    const { data: cms, error: cmErr } = await admin
      .from('comments')
      .select('parent_id')
      .eq('parent_type', 'deal_dev')
      .in('parent_id', dealIds)
      .gte('created_at', sinceIso)
      .limit(2000);
    if (cmErr) throw new Error(`load comments: ${cmErr.message}`);
    for (const c of (cms ?? []) as any[]) {
      commentsByDeal.set(c.parent_id, (commentsByDeal.get(c.parent_id) ?? 0) + 1);
    }
  }

  const nowMs = now.getTime();
  const projects: ProjectFact[] = jobs.map((j) => {
    const stage = stageById.get(j.stage_id);
    const stageCode = stage?.code ?? '';
    const completedThisWeek = j.status === 'completed' && j.completed_at && j.completed_at >= sinceIso;
    const isNew = j.created_at >= sinceIso;
    const move = movesThisWeek.get(j.id);
    const lastChange = lastStageChange.get(j.id);
    const daysInStage = lastChange
      ? Math.floor((nowMs - lastChange.at) / DAY_MS)
      : (j.started_at ? Math.floor((nowMs - new Date(j.started_at).getTime()) / DAY_MS) : null);
    const daysSinceTouch = Math.floor((nowMs - new Date(j.updated_at).getTime()) / DAY_MS);

    const flags: string[] = [];
    if (stageCode === 'stuck') flags.push('stuck');
    if (j.is_blocked) flags.push('blocked');
    if (stageCode === 'waiting_client_approval' || stageCode === 'no_response') flags.push('waiting_client');
    if (!completedThisWeek && !stage?.is_terminal && daysSinceTouch >= STALE_DAYS) flags.push('stale');

    let weekNote = '';
    if (isNew) weekNote = 'νέο έργο';
    else if (move) weekNote = `${move.from} → ${move.to}`;

    return {
      code: j.code ?? '',
      client: clientNameById.get(j.client_id) ?? '—',
      stage: stageName(j.stage_id),
      daysInStage,
      daysSinceTouch,
      openTasks: openTasks.get(j.id) ?? 0,
      tasksResolvedThisWeek: resolvedTasks.get(j.id) ?? 0,
      commentsThisWeek: commentsByDeal.get(j.deal_id) ?? 0,
      weekNote,
      flags,
      _position: stage?.position ?? 0,
      _completed: completedThisWeek,
    } as ProjectFact & { _position: number; _completed: boolean };
  });

  // Completed-this-week jobs are counted in the totals but NOT listed in the
  // report body (owner decision 2026-08-17: the table shows running work only).
  const completedThisWeek = projects.filter((p: any) => p._completed).length;
  const running = projects.filter((p: any) => !p._completed);

  // Flagged projects float to the top; the rest follow board order.
  running.sort((a: any, b: any) =>
    (b.flags.length > 0 ? 1 : 0) - (a.flags.length > 0 ? 1 : 0) || a._position - b._position || a.client.localeCompare(b.client, 'el'));

  const facts: ReportFacts & { dealIdByJob: Map<string, string> } = {
    weekLabel: `${fmtDayEl(since)} – ${fmtDayEl(now)} ${now.getUTCFullYear()}`,
    totals: {
      active: running.length,
      newThisWeek: jobs.filter((j) => j.created_at >= sinceIso).length,
      movedThisWeek: movesThisWeek.size,
      completedThisWeek,
      flagged: running.filter((p) => p.flags.length > 0).length,
    },
    projects: running.map((p: any) => {
      const { _position: _1, _completed: _2, ...rest } = p;
      return rest as ProjectFact;
    }),
    dealIdByJob,
  };
  return facts;
}

// Narrative on top of the facts. Any failure (no key, HTTP error, bad JSON)
// falls back to a deterministic Greek overview so the report always ships.
async function narrate(facts: ReportFacts): Promise<{ overview: string; attention: string[]; ai: boolean; aiError?: string }> {
  const fallback = {
    overview:
      `Αυτή την εβδομάδα: ${facts.totals.movedThisWeek} έργα άλλαξαν στάδιο, ` +
      `${facts.totals.newThisWeek} νέα, ${facts.totals.completedThisWeek} ολοκληρώθηκαν. ` +
      `Σύνολο ενεργών: ${facts.totals.active}. Έργα που χρειάζονται προσοχή: ${facts.totals.flagged}.`,
    attention: facts.projects
      .filter((p) => p.flags.length > 0)
      .slice(0, 6)
      .map((p) => `${p.client}${p.code ? ` (${p.code})` : ''}: ${p.stage}, ${p.daysSinceTouch} ημέρες χωρίς κίνηση`),
    ai: false,
  };
  if (!OPENAI_API_KEY) return { ...fallback, aiError: 'OPENAI_API_KEY not configured' };
  try {
    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildReportInput(facts) },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`openai ${res.status}: ${errText.slice(0, 300)}`);
    }
    const payload = await res.json();
    const parsed = JSON.parse(String(payload?.choices?.[0]?.message?.content ?? ''));
    const overview = String(parsed?.overview ?? '').trim();
    const attention = Array.isArray(parsed?.attention)
      ? parsed.attention.map((x: unknown) => String(x)).filter((x: string) => x.trim() !== '').slice(0, 8)
      : [];
    if (!overview) throw new Error('empty overview');
    return { overview, attention, ai: true };
  } catch (e) {
    // The report must still ship — but leave the cause in the function logs
    // (and in the test/dry response) instead of vanishing.
    const msg = String((e as any)?.message ?? e).slice(0, 500);
    console.error(`webdev-weekly-report: AI narrative failed, using fallback: ${msg}`);
    return { ...fallback, aiError: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!URL || !SERVICE_KEY) return json({ error: 'Server misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const authed = token !== '' && REPORT_SECRET !== '' && timingSafeEqual(token, REPORT_SECRET);
  if (!authed) return json({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => null)) as { run?: boolean; test?: boolean; dry?: boolean } | null;
  if (!body || body.run !== true) return json({ error: 'Bad request' }, 400);

  try {
    const now = new Date();
    const { dealIdByJob: _d, ...facts } = await buildFacts(now);
    const { overview, attention, ai, aiError } = await narrate(facts);

    // Dry run: compute + narrate but send nothing — for previewing the AI
    // narrative and diagnosing OpenAI failures without emailing anyone.
    if (body.dry === true) {
      return json({
        dry: true,
        totals: facts.totals,
        projects: facts.projects.length,
        overview,
        attention,
        ai_narrative: ai,
        ai_error: aiError ?? null,
      });
    }

    const dedupeKey = body.test === true
      ? `webdev_weekly_test:${crypto.randomUUID()}`
      : `webdev_weekly:${isoWeekKey(now)}`;

    const { error: qErr } = await admin.from('email_outbox').insert({
      identity: 'internal',
      to_email: REPORT_TO,
      template_key: 'webdev_weekly_report',
      dedupe_key: dedupeKey,
      data: {
        week_label: facts.weekLabel,
        overview,
        attention,
        totals: facts.totals,
        projects: facts.projects,
        ai_generated: ai,
        test: body.test === true,
      },
    });
    if (qErr) return json({ error: `enqueue: ${qErr.message}` }, 500);

    return json({
      enqueued: true,
      to: REPORT_TO,
      dedupe_key: dedupeKey,
      projects: facts.projects.length,
      totals: facts.totals,
      ai_narrative: ai,
      ai_error: aiError ?? null,
    });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e).slice(0, 1000) }, 500);
  }
});
