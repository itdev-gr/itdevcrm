// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';

interface InviteUserBody {
  email: string;
  full_name: string;
  temp_password: string;
  group_codes: string[];
  is_admin?: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  // Verify caller is admin: use anon client + caller's JWT to fetch their profile.
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

  const body = (await req.json().catch(() => null)) as InviteUserBody | null;
  if (!body || !body.email || !body.full_name || !body.temp_password) {
    return new Response('Bad request', { status: 400, headers: corsHeaders });
  }

  const admin = createClient(url, serviceKey);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.temp_password,
    email_confirm: true,
    user_metadata: {
      full_name: body.full_name,
      must_change_password: true,
    },
  });
  if (createErr || !created.user) {
    return new Response(
      JSON.stringify({ error: createErr?.message ?? 'Could not create user' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const newUserId = created.user.id;

  if (body.is_admin) {
    await admin.from('profiles').update({ is_admin: true }).eq('user_id', newUserId);
  }

  if (body.group_codes.length > 0) {
    const { data: groups } = await admin
      .from('groups')
      .select('id, code')
      .in('code', body.group_codes);
    const rows = (groups ?? []).map((g: any) => ({ user_id: newUserId, group_id: g.id }));
    if (rows.length > 0) {
      await admin.from('user_groups').insert(rows);
    }
  }

  return new Response(JSON.stringify({ user_id: newUserId }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
