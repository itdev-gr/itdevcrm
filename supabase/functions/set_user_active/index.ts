// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';

interface SetUserActiveBody {
  user_id: string;
  is_active: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) {
    return new Response('Server misconfigured', { status: 500, headers: corsHeaders });
  }

  // Verify caller is admin via anon client + caller's JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerData } = await callerClient.auth.getUser();
  if (!callerData?.user) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  const { data: callerProfile } = await callerClient
    .from('profiles')
    .select('is_admin')
    .eq('user_id', callerData.user.id)
    .single();
  if (!callerProfile?.is_admin) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }

  const body = (await req.json().catch(() => null)) as SetUserActiveBody | null;
  if (!body || typeof body.user_id !== 'string' || typeof body.is_active !== 'boolean') {
    return new Response('Bad request', { status: 400, headers: corsHeaders });
  }

  // Admins cannot deactivate themselves — prevents lockout.
  if (!body.is_active && body.user_id === callerData.user.id) {
    return new Response(
      JSON.stringify({ error: 'You cannot deactivate your own account.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const admin = createClient(url, serviceKey);

  // Sync auth-layer ban state so login is blocked. Supabase's admin API accepts
  // a duration string; 'none' clears any ban. Effectively 100 years == permanent.
  const { error: banErr } = await admin.auth.admin.updateUserById(body.user_id, {
    ban_duration: body.is_active ? 'none' : '876000h',
  });
  if (banErr) {
    return new Response(
      JSON.stringify({ error: banErr.message ?? 'Could not update auth ban state' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Flip the profile flag — RLS-visible + app UI truth.
  const { error: profileErr } = await admin
    .from('profiles')
    .update({ is_active: body.is_active })
    .eq('user_id', body.user_id);
  if (profileErr) {
    return new Response(
      JSON.stringify({ error: profileErr.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // On deactivate: sign out ALL active sessions of this user so an existing
  // browser tab can't keep working until its access token expires.
  if (!body.is_active) {
    // signOut with 'global' scope invalidates every refresh token for the user.
    // Ignore errors — the auth ban + profile flip are already applied and the
    // client-side is_active gate will pick up the change on next check.
    await admin.auth.admin.signOut(body.user_id, 'global').catch(() => undefined);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
