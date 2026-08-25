// deno-lint-ignore-file no-explicit-any
// accounting-chat — the accounting team's AI assistant. OpenAI tool-calling
// over read-only data tools that all run on the CALLER'S JWT (RLS applies:
// each user sees exactly what they see in the CRM — expenses/P&L stay
// admin-only). Conversation history persists in ai_chat_* (RLS: own rows;
// this function writes assistant rows via service role AFTER verifying the
// conversation belongs to the caller).
//
// Auth: caller JWT → getUser → admin OR member of the `accounting` group.
// Model: AI_CHAT_MODEL env (default gpt-4o), existing OPENAI_API_KEY secret.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { systemPrompt } from './prompt.ts';
import { TOOL_DEFS, runTool } from './tools.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // baggage + sentry-trace: required for the CRM's Sentry-instrumented fetches.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const MODEL = Deno.env.get('AI_CHAT_MODEL') ?? 'gpt-4o';

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 20;

const admin = createClient(URL_, SERVICE_KEY);

async function openai(messages: any[], withTools: boolean): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1200,
      messages,
      ...(withTools ? { tools: TOOL_DEFS, tool_choice: 'auto' } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json();
  return payload.choices?.[0]?.message;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY not configured' }, 500);

  // --- Auth: valid user AND (admin OR accounting group) -------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(URL_, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await caller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  const [{ data: isAdmin }, { data: inGroup }] = await Promise.all([
    caller.rpc('current_user_is_admin'),
    caller.rpc('current_user_in_group', { p_code: 'accounting' }),
  ]);
  if (!isAdmin && !inGroup) return json({ error: 'forbidden' }, 403);

  // --- Input --------------------------------------------------------------
  let body: { conversation_id?: string; message?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const message = (body.message ?? '').trim();
  if (!message) return json({ error: 'empty message' }, 400);
  if (message.length > 4000) return json({ error: 'message too long' }, 400);

  // --- Conversation: verify ownership or create ---------------------------
  let conversationId = body.conversation_id ?? null;
  if (conversationId) {
    const { data: conv } = await admin.from('ai_chat_conversations')
      .select('id, user_id').eq('id', conversationId).maybeSingle();
    if (!conv || conv.user_id !== user.id) return json({ error: 'conversation not found' }, 404);
  } else {
    const { data: conv, error } = await admin.from('ai_chat_conversations')
      .insert({ user_id: user.id, title: message.slice(0, 80) })
      .select('id').single();
    if (error) return json({ error: error.message }, 500);
    conversationId = conv.id;
  }

  const { data: history } = await admin.from('ai_chat_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  const todayAthens = new Intl.DateTimeFormat('el-GR', {
    timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date());

  const messages: any[] = [
    { role: 'system', content: systemPrompt(todayAthens, !!isAdmin) },
    ...(history ?? []).reverse().map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  await admin.from('ai_chat_messages')
    .insert({ conversation_id: conversationId, role: 'user', content: message });

  // --- Agent loop ---------------------------------------------------------
  const toolsUsed: string[] = [];
  let reply = '';
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const msg = await openai(messages, round < MAX_TOOL_ROUNDS);
      if (!msg) throw new Error('empty completion');

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name ?? '';
          let args: any = {};
          try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /* keep {} */ }
          toolsUsed.push(name);
          const result = await runTool(caller as any, name, args);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result).slice(0, 24_000),
          });
        }
        continue;
      }

      reply = msg.content ?? '';
      break;
    }
    if (!reply) reply = 'Δεν κατάφερα να ολοκληρώσω την απάντηση — δοκίμασε να ξαναδιατυπώσεις την ερώτηση.';
  } catch (e) {
    console.error('accounting-chat error:', e);
    return json({ error: e instanceof Error ? e.message : String(e), conversation_id: conversationId }, 500);
  }

  await admin.from('ai_chat_messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: reply,
    tool_payload: toolsUsed.length ? { tools_used: toolsUsed } : null,
  });
  await admin.from('ai_chat_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return json({ conversation_id: conversationId, reply, tools_used: toolsUsed });
});
