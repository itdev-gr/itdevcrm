// deno-lint-ignore-file no-explicit-any
// summarize-task — drains task_summary_outbox, asks OpenAI for a short Greek
// archival summary of a resolved task's comment thread, stores it on the task
// and posts it as a comment into the linked entity's channel.
//
// Trigger: a DB pulse (and 10-min cron backstop) POSTs `{drain:true}` with a
// `Bearer <TASK_SUMMARY_SECRET>` header. Auth, admin client, drain loop and the
// external-API call shape all mirror send-email/index.ts.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { timingSafeEqual } from '../_shared/timing.ts';
import { buildSummaryInput, SYSTEM_PROMPT } from './prompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TASK_SUMMARY_SECRET = Deno.env.get('TASK_SUMMARY_SECRET') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const admin = createClient(URL, SERVICE_KEY);

type OutboxRow = {
  id: string;
  task_kind: 'user' | 'assigned';
  task_id: string;
  status: string;
  attempts: number;
};

// Process one claimed row end-to-end. Returns normally on success (including the
// zero-comment / missing-task no-op paths); THROWS on any failure so the drain
// loop can flip the row back to 'pending'. Never writes the outbox status here —
// the drain loop owns that so a status-write failure can't trigger a re-summary.
async function processRow(row: OutboxRow): Promise<void> {
  const kind = row.task_kind;
  const taskId = row.task_id;
  const table = kind === 'assigned' ? 'assigned_tasks' : 'user_tasks';

  // 1) Load the task. assigned → description + single resolver; user → notes +
  //    dual resolvers (assignee wins, else creator).
  const cols = kind === 'assigned'
    ? 'title, description, resolved_by_user_id'
    : 'title, notes, assignee_resolved_by, creator_resolved_by';
  const { data: task, error: taskErr } = await admin
    .from(table).select(cols).eq('id', taskId).maybeSingle();
  if (taskErr) throw new Error(`load task: ${taskErr.message}`);
  // Task vanished (deleted after enqueue) → nothing to summarize; terminal no-op.
  if (!task) return;

  // 2) Load its comments oldest-first.
  const commentCol = kind === 'assigned' ? 'assigned_task_id' : 'user_task_id';
  const { data: rawComments, error: cErr } = await admin
    .from('task_comments')
    .select('author_user_id, body, created_at')
    .eq(commentCol, taskId)
    .order('created_at', { ascending: true });
  if (cErr) throw new Error(`load comments: ${cErr.message}`);
  const comments = (rawComments ?? []) as { author_user_id: string; body: string; created_at: string }[];

  // Zero comments → mark sent (by returning), no LLM call, no comment posted.
  if (comments.length === 0) return;

  // 3) Author display names from profiles (full_name → email → fallback).
  const authorIds = [...new Set(comments.map((c) => c.author_user_id).filter(Boolean))];
  const nameById = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profs, error: pErr } = await admin
      .from('profiles').select('user_id, full_name, email').in('user_id', authorIds);
    if (pErr) throw new Error(`load profiles: ${pErr.message}`);
    for (const p of (profs ?? []) as any[]) {
      nameById.set(p.user_id, (p.full_name ?? '').trim() || p.email || 'Χρήστης');
    }
  }

  // 4) Build the LLM user message.
  const t = task as any;
  const title = String(t.title ?? '');
  const description = kind === 'assigned' ? (t.description ?? null) : (t.notes ?? null);
  const input = buildSummaryInput(
    { title, description },
    comments.map((c) => ({
      authorName: nameById.get(c.author_user_id) ?? 'Χρήστης',
      createdAt: c.created_at,
      body: c.body,
    })),
  );

  // 5) OpenAI chat completion.
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`openai ${res.status}: ${errText.slice(0, 500)}`);
  }
  const payload = await res.json().catch(() => null);
  const summary = String(payload?.choices?.[0]?.message?.content ?? '').trim();
  if (!summary) throw new Error('openai returned empty content');

  // 6) Persist the summary on the task.
  const { error: upErr } = await admin.from(table).update({ summary }).eq('id', taskId);
  if (upErr) throw new Error(`update summary: ${upErr.message}`);

  // 7) Route + post the summary comment. Final resolver authors it.
  const resolverId = kind === 'assigned'
    ? t.resolved_by_user_id
    : (t.assignee_resolved_by ?? t.creator_resolved_by);

  const { data: targetRows, error: tErr } = await admin
    .rpc('task_comment_target', { p_kind: kind, p_task_id: taskId });
  if (tErr) throw new Error(`comment target: ${tErr.message}`);
  const target = (Array.isArray(targetRows) ? targetRows[0] : targetRows) as
    { parent_type: string; parent_id: string | null } | null | undefined;

  // Null-guard: no row, a null parent_id (e.g. a job whose deal_id is null), or a
  // missing resolver (comments.author_id is NOT NULL) → summary stays on the task
  // only, no comment. Guarding the resolver avoids a crash-loop on a degenerate row.
  if (target && target.parent_id && resolverId) {
    const { error: insErr } = await admin.from('comments').insert({
      parent_type: target.parent_type,
      parent_id: target.parent_id,
      author_id: resolverId,
      body: `🤖 Σύνοψη task: «${title}»\n${summary}`,
      mentioned_user_ids: [],
      task_key: `${kind}:${taskId}`,
    });
    if (insErr) throw new Error(`insert comment: ${insErr.message}`);
  }
}

async function drain(): Promise<{ processed: number; sent: number; failed: number }> {
  // Atomically claim pending rows (recover-stale + attempts bump folded in).
  const { data: rows, error } = await admin.rpc('claim_task_summaries', { p_limit: 20 });
  if (error) return { processed: 0, sent: 0, failed: 0 };

  let sent = 0, failed = 0;
  for (const row of ((rows ?? []) as OutboxRow[])) {
    let ok = true;
    let errMsg: string | null = null;
    try {
      await processRow(row);
    } catch (e) {
      ok = false;
      errMsg = String((e as any)?.message ?? e).slice(0, 1000);
    }
    // Outbox status write is isolated + guarded: it must NEVER throw out of the
    // loop. If it fails, the row is left 'sending' and claim's 5-minute
    // stale-recovery re-queues it on a later drain.
    try {
      if (ok) {
        await admin.from('task_summary_outbox')
          .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id);
        sent++;
      } else {
        await admin.from('task_summary_outbox')
          .update({ status: 'pending', last_error: errMsg }).eq('id', row.id);
        failed++;
      }
    } catch (_e) { /* leave row 'sending' for stale-recovery */ }
  }
  return { processed: (rows ?? []).length, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!URL || !SERVICE_KEY) return json({ error: 'Server misconfigured' }, 500);

  // Bearer auth: constant-time compare against TASK_SUMMARY_SECRET. Guard the
  // empty-token-vs-unset-secret case explicitly.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const authed = token !== '' && TASK_SUMMARY_SECRET !== '' && timingSafeEqual(token, TASK_SUMMARY_SECRET);
  if (!authed) return json({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => null)) as { drain?: boolean } | null;
  if (!body || body.drain !== true) return json({ error: 'Bad request' }, 400);

  return json(await drain());
});
