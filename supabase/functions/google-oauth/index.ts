// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { signState, verifyState, buildAuthUrl, exchangeCode, emailFromIdToken, encryptToken } from '../_shared/google.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const STATE_SECRET = Deno.env.get('GMAIL_STATE_SECRET')!;
const TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY')!;
const APP_URL = Deno.env.get('APP_URL')!;
const REDIRECT_URI = `${URL_}/functions/v1/google-oauth`;

const admin = createClient(URL_, SERVICE_KEY);

async function callerUserId(authHeader: string): Promise<string | null> {
  const c = createClient(URL_, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data } = await c.auth.getUser();
  return data?.user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);

  // Google callback (GET ?code&state)
  if (req.method === 'GET' && url.searchParams.has('code')) {
    const code = url.searchParams.get('code')!;
    const state = url.searchParams.get('state') ?? '';
    const verified = await verifyState(state, STATE_SECRET);
    if (!verified?.uid) return Response.redirect(`${APP_URL}/profile?google=error`, 302);
    const tok = await exchangeCode(code, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    if (!tok.refresh_token || !tok.id_token) return Response.redirect(`${APP_URL}/profile?google=error`, 302);
    const email = emailFromIdToken(tok.id_token) ?? 'unknown';
    const enc = await encryptToken(tok.refresh_token, TOKEN_KEY);
    await admin.from('user_google_accounts').upsert({
      user_id: verified.uid, google_email: email, refresh_token_enc: enc, connected_at: new Date().toISOString(), revoked_at: null,
    });
    return Response.redirect(`${APP_URL}/profile?google=connected`, 302);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const uid = await callerUserId(auth);
  if (!uid) return json({ error: 'Unauthorized' }, 401);
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === 'start') {
    const state = await signState({ uid }, STATE_SECRET, 600);
    return json({ url: buildAuthUrl(CLIENT_ID, REDIRECT_URI, state) });
  }
  if (body.action === 'disconnect') {
    await admin.from('user_google_accounts').update({ revoked_at: new Date().toISOString() }).eq('user_id', uid);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
});
